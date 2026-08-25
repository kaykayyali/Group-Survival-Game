/*
 * Soundscape: a fully synthesized WebAudio bed for the night. No audio
 * files, no external assets — every sound is built from oscillators and
 * generated noise buffers at runtime.
 *
 *  - Ambient bed: low filtered brown-noise wind + a slow detuned sub
 *    drone, kept well under everything else.
 *  - Zombie presence: bandpassed groan swells whose rate and gain follow
 *    how many of the dead are near your own player.
 *  - Combat: a soft bow-release thump on the shots feed, a wet tick on
 *    hits, a heavier fall on deaths — all attenuated by distance.
 *  - Body: below ~40 HP a slow heartbeat (lub-dub sine thumps) rises as
 *    HP falls; infection adds a faint high shimmer only you can hear.
 *  - M toggles mute.
 *
 * Autoplay policy: nothing is created until the first user gesture
 * (pointer or key); before that the whole module is inert. Everything is
 * guarded — with no AudioContext (or in a headless test browser that
 * never gestures) this file does nothing and throws nothing.
 *
 * State integration is observational only: it wraps
 * Group_Survive_State.prototype.render_snapshot / on_local_fire after the
 * originals run, and reads the snapshot feeds (shots / hits / deaths),
 * zombie positions and the own player's hp / infection. Nothing gameplay-
 * side is ever touched.
 */
(function() {
    'use strict';

    window.Soundscape_State = 'idle';

    var AC = null;
    try {
        AC = window.AudioContext || window.webkitAudioContext || null;
    } catch (e) { AC = null; }

    var Soundscape = {
        status: 'idle',      // 'idle' | 'running' | 'unavailable'
        muted: false,
        ctx: null,
        master: null,        // master gain (mute target)
        bed: null,           // ambient bed bus (well under the effects)
        fx: null,            // transient effects bus
        wind_gain: null,
        wind_filter: null,
        drone_gain: null,
        shimmer_gain: null,
        update_timer: null,

        // Observed game state (fed by the render_snapshot wrap).
        own_x: null,
        own_y: null,
        own_hp: 100,
        own_alive: true,
        own_infection: 0,
        presence: 0,         // 0..1 — how close/many the dead are
        last_observe: 0,

        // Schedulers.
        next_groan_at: 0,
        next_beat_at: 0,
        next_gust_at: 0
    };
    window.Soundscape = Soundscape;

    var MASTER_LEVEL = 0.7;

    /* ---------------- lifecycle ---------------- */

    Soundscape.start = function() {
        // First user gesture lands here. Idempotent; safe with no WebAudio.
        try {
            if (this.status === 'running') {
                if (this.ctx && this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(function() {});
                }
                return;
            }
            if (this.status === 'unavailable') { return; }
            if (!AC) {
                this.status = 'unavailable';
                return;
            }
            if (!this.ctx) {
                this.ctx = new AC();
                this.build_graph();
            }
            var self = this;
            var mark_running = function() {
                if (self.ctx && self.ctx.state === 'running') {
                    self.status = 'running';
                    window.Soundscape_State = 'running';
                }
            };
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().then(mark_running, function() {});
            }
            else {
                mark_running();
            }
            try { this.ctx.onstatechange = mark_running; } catch (e) {}
            if (!this.update_timer) {
                this.update_timer = setInterval(function() {
                    try { self.update(); } catch (e) {}
                }, 120);
            }
        } catch (e) {
            this.status = 'unavailable';
        }
    };

    Soundscape.build_graph = function() {
        var ctx = this.ctx;

        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;

        // A gentle compressor keeps stacked transients from clipping.
        var out = ctx.destination;
        try {
            if (ctx.createDynamicsCompressor) {
                var comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -18;
                comp.knee.value = 24;
                comp.ratio.value = 6;
                this.master.connect(comp);
                comp.connect(out);
            }
            else {
                this.master.connect(out);
            }
        } catch (e) {
            try { this.master.connect(out); } catch (e2) {}
        }

        // Bed bus sits well under the effects bus.
        this.bed = ctx.createGain();
        this.bed.gain.value = 0.5;
        this.bed.connect(this.master);

        this.fx = ctx.createGain();
        this.fx.gain.value = 1.0;
        this.fx.connect(this.master);

        /* -- wind: looping brown noise through a low lowpass, slow gusts -- */
        var noise = ctx.createBufferSource();
        noise.buffer = this.make_brown_noise(4);
        noise.loop = true;
        this.wind_filter = ctx.createBiquadFilter();
        this.wind_filter.type = 'lowpass';
        this.wind_filter.frequency.value = 220;
        this.wind_filter.Q.value = 0.6;
        this.wind_gain = ctx.createGain();
        this.wind_gain.gain.value = 0.05;
        noise.connect(this.wind_filter);
        this.wind_filter.connect(this.wind_gain);
        this.wind_gain.connect(this.bed);
        noise.start();

        // A very slow LFO leans on the wind filter so the howl wanders.
        var wind_lfo = ctx.createOscillator();
        wind_lfo.frequency.value = 0.05;
        var wind_lfo_amt = ctx.createGain();
        wind_lfo_amt.gain.value = 90;
        wind_lfo.connect(wind_lfo_amt);
        wind_lfo_amt.connect(this.wind_filter.frequency);
        wind_lfo.start();

        /* -- sub drone: two barely detuned sines, almost felt not heard -- */
        this.drone_gain = ctx.createGain();
        this.drone_gain.gain.value = 0.045;
        this.drone_gain.connect(this.bed);
        var freqs = [48, 48.7];
        for (var i = 0; i < freqs.length; i++) {
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freqs[i];
            osc.connect(this.drone_gain);
            osc.start();
        }

        /* -- infection shimmer: a faint beating high pair, gated by state -- */
        this.shimmer_gain = ctx.createGain();
        this.shimmer_gain.gain.value = 0;
        this.shimmer_gain.connect(this.master);
        var sh_freqs = [2300, 2309];
        for (var s = 0; s < sh_freqs.length; s++) {
            var sh = ctx.createOscillator();
            sh.type = 'sine';
            sh.frequency.value = sh_freqs[s];
            sh.connect(this.shimmer_gain);
            sh.start();
        }
    };

    Soundscape.make_brown_noise = function(seconds) {
        var ctx = this.ctx;
        var length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
        var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        var last = 0;
        for (var i = 0; i < length; i++) {
            var white = Math.random() * 2 - 1;
            last = (last + 0.02 * white) / 1.02;
            data[i] = last * 3.5;
        }
        return buffer;
    };

    Soundscape.make_white_noise = function(seconds) {
        var ctx = this.ctx;
        var length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
        var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    };

    Soundscape.set_muted = function(muted) {
        this.muted = !!muted;
        try {
            if (this.master && this.ctx) {
                var t = this.ctx.currentTime;
                this.master.gain.cancelScheduledValues(t);
                this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER_LEVEL, t, 0.06);
            }
        } catch (e) {}
        try {
            if (window.Group_Survive && Group_Survive.display_new_message) {
                Group_Survive.display_new_message(this.muted ?
                    'the world goes quiet (M for sound)' : 'you listen again (M mutes)');
            }
        } catch (e) {}
    };

    /* ---------------- state observation ---------------- */

    // Called (guarded) after every render_snapshot with the live state and
    // the raw snapshot. Reads positions/feeds; plays nothing before start.
    Soundscape.observe = function(state, snapshot) {
        if (!snapshot) { return; }
        var own = null;
        var players = snapshot.players || [];
        var own_id = state && state.client ? state.client.player_id : null;
        for (var i = 0; i < players.length; i++) {
            if (players[i].id === own_id) { own = players[i]; break; }
        }
        if (own) {
            this.own_x = own.x;
            this.own_y = own.y;
            this.own_hp = typeof own.hp === 'number' ? own.hp : this.own_hp;
            this.own_alive = !!own.alive;
            this.own_infection = (own.infected && own.alive) ? (own.infection || 0.5) : 0;
        }

        // Zombie presence: how many, how close. Saturates around a small
        // pack breathing down your neck.
        var zombies = snapshot.zombies || [];
        var sum = 0;
        if (this.own_x !== null) {
            for (var z = 0; z < zombies.length; z++) {
                var dz = this.dist(zombies[z].x, zombies[z].y);
                if (dz < 460) { sum += 1 - dz / 460; }
            }
        }
        this.presence = Math.min(1, sum / 3.5);
        this.last_observe = Date.now();

        if (this.status !== 'running') { return; }

        // Combat feeds (distance-attenuated, capped per snapshot).
        var shots = snapshot.shots || [];
        var played = 0;
        for (var sh = 0; sh < shots.length && played < 3; sh++) {
            if (shots[sh].id === own_id) { continue; } // own shot is on_local_fire
            var g = this.gain_for(shots[sh].x, shots[sh].y, 0.22);
            if (g > 0.004) { this.play_shot(g); played++; }
        }
        var hits = snapshot.hits || [];
        for (var h = 0; h < hits.length && h < 4; h++) {
            var hg = this.gain_for(hits[h].x, hits[h].y, 0.24);
            if (hg > 0.004) { this.play_hit(hg); }
        }
        var deaths = snapshot.deaths || [];
        for (var d = 0; d < deaths.length && d < 3; d++) {
            var dg = this.gain_for(deaths[d].x, deaths[d].y, 0.4);
            if (dg > 0.004) { this.play_death(dg); }
        }
    };

    Soundscape.dist = function(x, y) {
        if (this.own_x === null || typeof x !== 'number') { return 1e9; }
        var dx = x - this.own_x, dy = y - this.own_y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    Soundscape.gain_for = function(x, y, base) {
        var d = this.dist(x, y);
        if (d > 1e8) { return base * 0.5; } // position unknown: mid level
        if (d > 720) { return 0; }
        var f = 1 / (1 + d / 220);
        var v = base * f * f * 2.2;
        return v > base ? base : v;
    };

    /* ---------------- continuous update ---------------- */

    Soundscape.update = function() {
        if (this.status !== 'running' || !this.ctx) { return; }
        var ctx = this.ctx;
        var now = ctx.currentTime;

        // If snapshots stop (menu, disconnect), let the world empty out.
        if (Date.now() - this.last_observe > 3000) { this.presence *= 0.9; }

        // Wind gusts: nudge the wind level somewhere new now and then.
        if (now >= this.next_gust_at) {
            this.next_gust_at = now + 4 + Math.random() * 7;
            try {
                this.wind_gain.gain.setTargetAtTime(
                    0.035 + Math.random() * 0.04, now, 2.5);
            } catch (e) {}
        }

        // Zombie groans: rate and weight ride the presence.
        var p = this.presence;
        if (p > 0.03 && now >= this.next_groan_at) {
            this.next_groan_at = now +
                (2.2 + Math.random() * 3.8) / (0.3 + p * 0.9);
            this.play_groan(0.05 + 0.16 * p * (0.7 + Math.random() * 0.5));
        }
        else if (p <= 0.03 && now >= this.next_groan_at) {
            // Quiet night: keep the scheduler from firing a stale groan
            // the instant the horde shows up right next to you.
            this.next_groan_at = now + 1;
        }

        // Heartbeat under ~40 HP, faster and louder as it falls.
        if (this.own_alive && this.own_hp < 40) {
            if (now >= this.next_beat_at) {
                var hp = Math.max(0, this.own_hp);
                var period = 0.55 + 0.75 * (hp / 40);
                var beat_gain = 0.1 + 0.22 * (1 - hp / 40);
                this.next_beat_at = now + period;
                this.thump(now, 62, 34, 0.1, beat_gain);           // lub
                this.thump(now + 0.16, 52, 30, 0.09, beat_gain * 0.65); // dub
            }
        }
        else {
            this.next_beat_at = now + 0.4;
        }

        // Infection shimmer: a thin beating whine, throbbing slightly.
        try {
            var target = 0;
            if (this.own_infection > 0 && this.own_alive) {
                target = 0.008 + 0.014 * Math.min(1, this.own_infection);
                target *= 0.8 + 0.2 * Math.sin(now * 2.4);
            }
            this.shimmer_gain.gain.setTargetAtTime(target, now, 0.4);
        } catch (e) {}
    };

    /* ---------------- one-shot synths ---------------- */

    // A pitched sine drop with an exponential-ish envelope: the basic thud.
    Soundscape.thump = function(when, f0, f1, dur, gain) {
        try {
            var ctx = this.ctx;
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f0, when);
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), when + dur);
            var g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, when);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.012);
            g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
            osc.connect(g);
            g.connect(this.fx);
            osc.start(when);
            osc.stop(when + dur + 0.05);
        } catch (e) {}
    };

    // A filtered noise burst: snaps, ticks, falls.
    Soundscape.noise_burst = function(when, type, freq, q, dur, gain) {
        try {
            var ctx = this.ctx;
            var src = ctx.createBufferSource();
            src.buffer = this.make_white_noise(dur + 0.1);
            var filter = ctx.createBiquadFilter();
            filter.type = type;
            filter.frequency.setValueAtTime(freq, when);
            filter.Q.value = q;
            var g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, when);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.008);
            g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
            src.connect(filter);
            filter.connect(g);
            g.connect(this.fx);
            src.start(when);
            src.stop(when + dur + 0.05);
        } catch (e) {}
    };

    // Bow release: a soft low thump and the dry snap of the string.
    Soundscape.play_shot = function(gain) {
        if (this.status !== 'running') { return; }
        var t = this.ctx.currentTime;
        this.thump(t, 170, 60, 0.1, gain);
        this.noise_burst(t, 'highpass', 1500, 0.8, 0.05, gain * 0.5);
    };

    // Arrow finding meat: a short wet tick.
    Soundscape.play_hit = function(gain) {
        if (this.status !== 'running') { return; }
        var t = this.ctx.currentTime;
        this.noise_burst(t, 'bandpass', 750, 2.5, 0.07, gain);
        this.thump(t, 210, 110, 0.05, gain * 0.7);
    };

    // A body going down: heavier, lower, longer.
    Soundscape.play_death = function(gain) {
        if (this.status !== 'running') { return; }
        var t = this.ctx.currentTime;
        this.thump(t, 110, 36, 0.38, gain);
        this.noise_burst(t + 0.02, 'lowpass', 240, 0.7, 0.3, gain * 0.8);
        this.noise_burst(t + 0.01, 'bandpass', 620, 2, 0.06, gain * 0.45);
    };

    // A groan out in the dark: a sagging saw through a sweeping bandpass,
    // with a breath of noise underneath. Panned a little at random.
    Soundscape.play_groan = function(gain) {
        if (this.status !== 'running') { return; }
        try {
            var ctx = this.ctx;
            var t = ctx.currentTime;
            var dur = 1 + Math.random() * 0.9;
            var f0 = 68 + Math.random() * 40;

            var osc = ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(f0, t);
            osc.frequency.linearRampToValueAtTime(f0 * 0.72, t + dur);

            var breath = ctx.createBufferSource();
            breath.buffer = this.make_white_noise(dur + 0.1);

            var filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(260 + Math.random() * 120, t);
            filter.frequency.linearRampToValueAtTime(150, t + dur);
            filter.Q.value = 5;

            var breath_gain = ctx.createGain();
            breath_gain.gain.value = 0.35;

            var g = ctx.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + dur * 0.35);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

            osc.connect(filter);
            breath.connect(breath_gain);
            breath_gain.connect(filter);
            filter.connect(g);

            var tail = g;
            if (ctx.createStereoPanner) {
                var pan = ctx.createStereoPanner();
                pan.pan.value = (Math.random() * 2 - 1) * 0.6;
                g.connect(pan);
                tail = pan;
            }
            tail.connect(this.fx);
            osc.start(t);
            osc.stop(t + dur + 0.05);
            breath.start(t);
            breath.stop(t + dur + 0.05);
        } catch (e) {}
    };

    /* ---------------- wiring ---------------- */

    // First gesture starts the context (autoplay policy); later gestures
    // just re-resume it if the browser suspended it.
    var on_gesture = function() {
        try { Soundscape.start(); } catch (e) {}
    };
    try {
        window.addEventListener('pointerdown', on_gesture, true);
        window.addEventListener('keydown', on_gesture, true);
        window.addEventListener('keydown', function(e) {
            try {
                if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) { return; }
                if (e.key === 'm' || e.key === 'M') {
                    Soundscape.set_muted(!Soundscape.muted);
                }
            } catch (err) {}
        });
    } catch (e) {}

    // Observe the game by wrapping its state methods after the originals
    // run. The state's constructor (Fast_Bindall) copies BOUND prototype
    // methods onto the instance, so once an instance exists a prototype
    // wrap attaches to code nobody calls — the live instance itself must
    // be wrapped. The prototype wrap still helps when this script loads
    // before the instance is constructed: the constructor then binds the
    // already-wrapped methods. The inherited __soundscape_wrapped flag
    // keeps the two paths from double-wrapping.
    var wrap_methods = function(target) {
        if (!target || target.__soundscape_wrapped) { return false; }
        if (typeof target.render_snapshot === 'function') {
            var orig_render = target.render_snapshot;
            target.render_snapshot = function(snapshot) {
                var result = orig_render.apply(this, arguments);
                try { Soundscape.observe(this, snapshot); } catch (e) {}
                return result;
            };
        }
        if (typeof target.on_local_fire === 'function') {
            var orig_fire = target.on_local_fire;
            target.on_local_fire = function() {
                try {
                    if (this.current_ammo > 0) { Soundscape.play_shot(0.26); }
                } catch (e) {}
                return orig_fire.apply(this, arguments);
            };
        }
        target.__soundscape_wrapped = true;
        return true;
    };
    var wrap_state = function() {
        try {
            var instance = window.Group_Survive;
            if (instance && typeof instance.render_snapshot === 'function') {
                wrap_methods(instance);
                return true; // live instance covered (directly or via wrapped prototype)
            }
            var ctor = window.Group_Survive_State;
            if (ctor && ctor.prototype) { wrap_methods(ctor.prototype); }
            return false; // keep watching until the live instance exists
        } catch (e) { return true; } // never keep retrying a throwing wrap
    };
    try {
        if (!wrap_state()) {
            var tries = 0;
            var wrap_timer = setInterval(function() {
                if (wrap_state() || ++tries > 120) { clearInterval(wrap_timer); }
            }, 250);
        }
    } catch (e) {}
})();
