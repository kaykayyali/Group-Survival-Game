/*
 * Main Phaser state. The server is authoritative: every frame we render the
 * latest snapshot (players, zombies, arrows, pickups) and the HUD, while
 * Main_Player handles local movement and sends inputs upstream.
 */
Group_Survive_State = function(game, client) {
    Fast_Bindall(this);
    this.game = game;
    this.client = client;
    this.zombie_sprites = {};
    this.remote_player_sprites = {};
    this.projectile_sprites = {};
    this.pickup_sprites = {};
    this.displayed_messages = [];
    this.pending_snapshot = null;
};

Group_Survive_State.prototype = {
    preload: function() {
        this.game.load.image('arrow', 'assets/sprites/arrow.png');
        this.game.load.image('bow', 'assets/sprites/bow.png');
    },
    create: function() {
        console.log("LOADING");
        this.game.world.setBounds(0, 0, this.client.world.width, this.client.world.height);
        this.game.stage.backgroundColor = '#07090c';
        this.create_textures();
        this.atmosphere = new Atmosphere(this.game, this);
        this.zombie_eyes_group = this.game.add.group();
        this.main_player = new Main_Player(this.game, this.client);
        this.game.camera.follow(this.main_player.sprite);
        this.create_hud();
        this.created = true;
    },
    create_textures: function() {
        // Everything but the bow/arrow art is generated at runtime.
        this.create_zombie_sheets();

        // Blood particle for transient bursts (bright enough to read for a
        // beat even in the gloom before the permanent decal takes over).
        var blood_bmd = this.game.make.bitmapData(4, 4);
        blood_bmd.context.fillStyle = '#8e1810';
        blood_bmd.context.fillRect(0, 0, 4, 4);
        blood_bmd.context.fillStyle = '#c03424';
        blood_bmd.context.fillRect(1, 1, 2, 2);
        blood_bmd.dirty = true;
        this.blood_particle_bmd = blood_bmd;
        this.blood_particles = [];

        // Eye-shine: two pale blank eyes, the only part of a zombie that
        // reads outside the light. Drawn facing +x like the body frames.
        var eyes_bmd = this.game.make.bitmapData(14, 14);
        var ectx = eyes_bmd.context;
        ectx.fillStyle = 'rgba(214,222,204,0.95)';
        ectx.beginPath(); ectx.arc(10.5, 5, 1.4, 0, Math.PI * 2); ectx.fill();
        ectx.beginPath(); ectx.arc(10.5, 9, 1.4, 0, Math.PI * 2); ectx.fill();
        eyes_bmd.dirty = true;
        this.zombie_eyes_bmd = eyes_bmd;

        var ammo_graphic = this.game.add.graphics(0, 0);
        ammo_graphic.beginFill(0x9c8631);
        ammo_graphic.drawRect(0, 0, 18, 18);
        ammo_graphic.endFill();
        this.ammo_texture = ammo_graphic.generateTexture();
        ammo_graphic.destroy();

        var health_graphic = this.game.add.graphics(0, 0);
        health_graphic.beginFill(0x8f3d34);
        health_graphic.drawRect(0, 7, 18, 4);
        health_graphic.drawRect(7, 0, 4, 18);
        health_graphic.endFill();
        this.health_texture = health_graphic.generateTexture();
        health_graphic.destroy();
    },
    create_zombie_sheets: function() {
        // Three humanoid silhouettes, drawn programmatically, four animation
        // frames each (limbs swing with pose = 0, 1, 0, -1). All face +x so
        // rotation follows their heading.
        var specs = {
            walker: { fw: 44, fh: 44, fps: 5 },
            runner: { fw: 46, fh: 44, fps: 11 },
            crawler: { fw: 48, fh: 36, fps: 4 }
        };
        var poses = [0, 1, 0, -1];
        this.zombie_anim_fps = {};
        for (var kind in specs) {
            var spec = specs[kind];
            this.zombie_anim_fps[kind] = spec.fps;
            var bmd = this.game.make.bitmapData(spec.fw * 4, spec.fh);
            for (var f = 0; f < 4; f++) {
                var ctx = bmd.context;
                ctx.save();
                ctx.translate(f * spec.fw, 0);
                draw_zombie_frame(ctx, kind, spec.fw / 2, spec.fh / 2, poses[f]);
                ctx.restore();
            }
            bmd.dirty = true;
            this.game.cache.addSpriteSheet('zombie_' + kind, '', bmd.canvas, spec.fw, spec.fh, 4);
        }
    },
    spawn_blood_burst: function(x, y, big) {
        // Transient spray on wounds and kills; the permanent mark is
        // stamped into the atmosphere's decal layer separately.
        var count = big ? 10 : 5;
        for (var i = 0; i < count; i++) {
            var sprite = this.game.add.sprite(x, y, this.blood_particle_bmd);
            sprite.anchor.set(0.5);
            var angle = Math.random() * Math.PI * 2;
            var speed = 30 + Math.random() * (big ? 130 : 90);
            this.blood_particles.push({
                sprite: sprite,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 0.25 + Math.random() * 0.3
            });
        }
    },
    update_blood_particles: function() {
        var dt = this.game.time.physicsElapsed;
        for (var i = this.blood_particles.length - 1; i >= 0; i--) {
            var p = this.blood_particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                p.sprite.destroy();
                this.blood_particles.splice(i, 1);
                continue;
            }
            p.sprite.x += p.vx * dt;
            p.sprite.y += p.vy * dt;
            p.vx *= 0.9;
            p.vy *= 0.9;
            p.sprite.alpha = Math.min(1, p.life * 4);
        }
    },
    update_zombie_motion: function() {
        // Ease sprites toward their server positions, face the direction of
        // travel, and layer on a per-zombie wobble so the walk cycles do not
        // sync up: shamble, sprint and drag each read differently in motion.
        var t = this.game.time.now / 1000;
        for (var id in this.zombie_sprites) {
            var sprite = this.zombie_sprites[id];
            if (sprite.target_x === undefined) { continue; }
            var prev_x = sprite.x, prev_y = sprite.y;
            sprite.x += (sprite.target_x - sprite.x) * 0.25;
            sprite.y += (sprite.target_y - sprite.y) * 0.25;
            var dx = sprite.x - prev_x, dy = sprite.y - prev_y;
            if (dx * dx + dy * dy > 0.05) {
                sprite.heading = lerp_angle(sprite.heading, Math.atan2(dy, dx), 0.18);
            }
            var kind = sprite.zombie_kind;
            var phase = sprite.wobble_phase;
            if (kind === 'runner') {
                sprite.rotation = sprite.heading + Math.sin(t * 9 + phase) * 0.05;
            }
            else if (kind === 'crawler') {
                sprite.rotation = sprite.heading + Math.sin(t * 2.6 + phase) * 0.14;
                sprite.scale.x = 1 + 0.1 * Math.sin(t * 5.2 + phase); // dragging lurch
            }
            else {
                sprite.rotation = sprite.heading + Math.sin(t * 3.1 + phase) * 0.1;
            }
            if (sprite.eyes) {
                sprite.eyes.x = sprite.x;
                sprite.eyes.y = sprite.y;
                sprite.eyes.rotation = sprite.rotation;
            }
        }
    },
    create_hud: function() {
        // NMRiH-style restraint: no permanent readouts anywhere. Health is
        // read off the screen itself (Atmosphere darkens, desaturates and
        // grains the frame as HP falls). The arrow count exists only as a
        // brief quiver-check that fades ~1.5s after it changes or after the
        // player presses R. Wave text marks transitions only, then sinks
        // back into the dark. Everything dim serif — closer to an epitaph
        // than a video-game overlay.
        this.hud_wave = this.game.add.text(this.game.camera.width / 2, 26, '', {
            font: "16px Georgia, 'Times New Roman', serif", fill: "#7d7769"
        });
        this.hud_wave.anchor.setTo(0.5, 0);
        this.hud_wave.setShadow(1, 1, 'rgba(0,0,0,0.85)', 3);
        this.hud_wave.fixedToCamera = true;
        this.hud_wave.alpha = 0;
        this.wave_shown_number = 0;
        this.wave_text_until = 0;

        this.hud_dead = this.game.add.text(this.game.camera.width / 2, this.game.camera.height / 2 - 12, '', {
            font: "22px Georgia, 'Times New Roman', serif", fill: "#6b2f27"
        });
        this.hud_dead.anchor.setTo(0.5, 0.5);
        this.hud_dead.setShadow(1, 2, 'rgba(0,0,0,0.9)', 4);
        this.hud_dead.fixedToCamera = true;
        this.hud_dead.alpha = 0;

        this.hud_dead_sub = this.game.add.text(this.game.camera.width / 2, this.game.camera.height / 2 + 18, '', {
            font: "italic 12px Georgia, 'Times New Roman', serif", fill: "#57534a"
        });
        this.hud_dead_sub.anchor.setTo(0.5, 0.5);
        this.hud_dead_sub.setShadow(1, 1, 'rgba(0,0,0,0.9)', 3);
        this.hud_dead_sub.fixedToCamera = true;
        this.hud_dead_sub.alpha = 0;

        // Quiver-check tally glyph: a small arrow silhouette, generated.
        var arrow_glyph = this.game.add.graphics(0, 0);
        arrow_glyph.beginFill(0x958e7b);
        arrow_glyph.drawPolygon([4, 0, 0, 7, 8, 7]);
        arrow_glyph.endFill();
        arrow_glyph.beginFill(0x847d6c);
        arrow_glyph.drawRect(3, 6, 2, 12);
        arrow_glyph.endFill();
        arrow_glyph.beginFill(0x6c665a);
        arrow_glyph.drawRect(1, 18, 6, 2);
        arrow_glyph.endFill();
        this.arrow_tally_texture = arrow_glyph.generateTexture();
        arrow_glyph.destroy();

        this.ammo_group = this.game.add.group();
        this.ammo_group.fixedToCamera = true;
        this.ammo_group.alpha = 0;
        this.show_ammo_until = 0;
        this.last_known_ammo = null;
        this.current_ammo = 0;

        var self = this;
        this.check_key = this.game.input.keyboard.addKey(Phaser.KeyCode.R);
        this.game.input.keyboard.addKeyCapture([Phaser.KeyCode.R]);
        this.check_key.onDown.add(function() {
            self.show_ammo_until = self.game.time.now + 1500;
            self.refresh_ammo_display();
        });
    },
    refresh_ammo_display: function() {
        // Rebuild the transient quiver readout: one tally per arrow,
        // grouped in fives, with a small dim count beneath.
        var count = this.current_ammo;
        this.ammo_group.removeAll(true);
        var cam_w = this.game.camera.width;
        var y = this.game.camera.height - 74;
        if (count <= 0) {
            var empty = this.game.add.text(0, 6, 'the quiver is empty', {
                font: "italic 13px Georgia, 'Times New Roman', serif", fill: "#77372c"
            });
            empty.setShadow(1, 1, 'rgba(0,0,0,0.85)', 3);
            empty.anchor.setTo(0.5, 0);
            this.ammo_group.add(empty);
            this.ammo_group.cameraOffset.x = cam_w / 2;
            this.ammo_group.cameraOffset.y = y;
            return;
        }
        var shown = Math.min(count, 30);
        var offsets = [];
        var x = 0;
        for (var i = 0; i < shown; i++) {
            offsets.push(x);
            x += 9 + ((i + 1) % 5 === 0 ? 6 : 0);
        }
        var total = offsets[shown - 1] + 8;
        for (i = 0; i < shown; i++) {
            var tally = this.game.add.sprite(offsets[i], 0, this.arrow_tally_texture);
            this.ammo_group.add(tally);
        }
        var label = this.game.add.text(total / 2, 26,
            count + (count === 1 ? ' arrow' : ' arrows'), {
            font: "italic 11px Georgia, 'Times New Roman', serif", fill: "#6d675b"
        });
        label.setShadow(1, 1, 'rgba(0,0,0,0.85)', 3);
        label.anchor.setTo(0.5, 0);
        this.ammo_group.add(label);
        this.ammo_group.cameraOffset.x = (cam_w - total) / 2;
        this.ammo_group.cameraOffset.y = y;
    },
    update: function() {
        if (this.pending_snapshot) {
            this.render_snapshot(this.pending_snapshot);
            this.pending_snapshot = null;
        }
        this.main_player.update();
        this.update_zombie_motion();
        this.update_blood_particles();
        if (this.atmosphere) {
            this.atmosphere.update();
        }
        this.update_hud();
    },
    update_hud: function() {
        // All HUD text lives and dies by alpha: nothing pops, everything
        // surfaces out of the dark and sinks back into it.
        var now = this.game.time.now;
        var wave_target = now < this.wave_text_until ? 0.92 : 0;
        this.hud_wave.alpha += (wave_target - this.hud_wave.alpha) * 0.05;

        var dead_target = this.hud_dead.text.length > 0 ? 0.85 : 0;
        this.hud_dead.alpha += (dead_target - this.hud_dead.alpha) * 0.03;
        this.hud_dead_sub.alpha = this.hud_dead.alpha * 0.8;

        var ammo_target = now < this.show_ammo_until ? 0.9 : 0;
        var ammo_rate = ammo_target > this.ammo_group.alpha ? 0.3 : 0.09;
        this.ammo_group.alpha += (ammo_target - this.ammo_group.alpha) * ammo_rate;

        // Feed lines sink away after a few seconds but stay in
        // displayed_messages until newer lines push them out.
        for (var i = 0; i < this.displayed_messages.length; i++) {
            var message = this.displayed_messages[i];
            if (message.born_at !== undefined && now - message.born_at > 4500) {
                message.alpha = Math.max(0, message.alpha - 0.012);
            }
        }

        // Atmosphere re-stacks its overlays every frame before this runs;
        // lift the HUD pieces it doesn't know about back above the post pass.
        this.game.world.bringToTop(this.ammo_group);
        this.game.world.bringToTop(this.hud_dead_sub);
    },
    render: function() {
    },
    apply_snapshot: function(snapshot) {
        // Snapshots arrive off the game loop; defer rendering to update().
        this.pending_snapshot = snapshot;
    },
    render_snapshot: function(snapshot) {
        var self = this;
        var own = null;
        var seen = {};

        snapshot.players.forEach(function(player) {
            if (player.id === self.client.player_id) {
                own = player;
                return;
            }
            seen[player.id] = true;
            var entry = self.remote_player_sprites[player.id];
            if (!entry) {
                var sprite = self.game.add.sprite(player.x, player.y, 'bow');
                sprite.anchor.set(0.5);
                sprite.tint = 0x7a90a8;
                var label = self.game.add.text(player.x, player.y - 26, player.name, {
                    font: "11px Arial", fill: "#8fa0ae", stroke: '#000000', strokeThickness: 2
                });
                label.anchor.setTo(0.5, 0.5);
                entry = self.remote_player_sprites[player.id] = { sprite: sprite, label: label };
            }
            entry.sprite.x = player.x;
            entry.sprite.y = player.y;
            entry.sprite.rotation = player.rotation;
            entry.sprite.visible = player.alive;
            entry.label.x = player.x;
            entry.label.y = player.y - 26;
            entry.label.visible = player.alive;
        });
        prune(this.remote_player_sprites, seen, function(entry) {
            entry.sprite.destroy();
            entry.label.destroy();
        });

        seen = {};
        snapshot.zombies.forEach(function(zombie) {
            seen[zombie.id] = true;
            var sprite = self.zombie_sprites[zombie.id];
            var kind = zombie.kind || 'walker';
            if (!sprite) {
                sprite = self.zombie_sprites[zombie.id] = self.game.add.sprite(zombie.x, zombie.y, 'zombie_' + kind);
                sprite.anchor.set(0.5);
                sprite.zombie_kind = kind;
                sprite.wobble_phase = Math.random() * Math.PI * 2;
                sprite.heading = Math.random() * Math.PI * 2;
                if (kind === 'walker') { sprite.scale.set(1.1); }
                sprite.animations.add('move');
                sprite.animations.play('move', self.zombie_anim_fps[kind] + Math.random() * 1.5, true);
                sprite.eyes = self.game.add.sprite(zombie.x, zombie.y, self.zombie_eyes_bmd);
                sprite.eyes.anchor.set(0.5);
                sprite.eyes.alpha = 0.5;
                if (kind === 'crawler') { sprite.eyes.scale.set(0.8); }
                self.zombie_eyes_group.add(sprite.eyes);
            }
            // Server position is the target; update_zombie_motion eases
            // toward it every frame and handles facing/wobble.
            sprite.target_x = zombie.x;
            sprite.target_y = zombie.y;
            // Bloodied zombies darken toward red.
            var health_ratio = Math.max(0, zombie.hp / zombie.max_hp);
            sprite.tint = health_ratio > 0.66 ? 0xffffff : (health_ratio > 0.33 ? 0xc4a293 : 0xa8746a);
        });
        prune(this.zombie_sprites, seen, function(sprite) {
            if (sprite.eyes) { sprite.eyes.destroy(); }
            sprite.destroy();
        });

        // Gore feeds: kills leave permanent corpses and pools; wounds
        // splatter the ground. Both persist in the atmosphere decal layer.
        if (snapshot.deaths && this.atmosphere) {
            snapshot.deaths.forEach(function(death) {
                self.atmosphere.stamp_corpse(death.x, death.y, death.kind);
                self.spawn_blood_burst(death.x, death.y, true);
            });
        }
        if (snapshot.hits && this.atmosphere) {
            snapshot.hits.forEach(function(hit) {
                self.atmosphere.stamp_blood(hit.x, hit.y, false);
                self.spawn_blood_burst(hit.x, hit.y, false);
            });
        }

        seen = {};
        snapshot.projectiles.forEach(function(projectile) {
            seen[projectile.id] = true;
            var sprite = self.projectile_sprites[projectile.id];
            if (!sprite) {
                sprite = self.projectile_sprites[projectile.id] = self.game.add.sprite(projectile.x, projectile.y, 'arrow');
                sprite.anchor.set(0.5);
            }
            sprite.x = projectile.x;
            sprite.y = projectile.y;
            sprite.rotation = projectile.rotation;
        });
        prune(this.projectile_sprites, seen, function(sprite) { sprite.destroy(); });

        seen = {};
        snapshot.pickups.forEach(function(pickup) {
            seen[pickup.id] = true;
            var sprite = self.pickup_sprites[pickup.id];
            if (!sprite) {
                var texture = pickup.kind === 'ammo' ? self.ammo_texture : self.health_texture;
                sprite = self.pickup_sprites[pickup.id] = self.game.add.sprite(pickup.x, pickup.y, texture);
                sprite.anchor.set(0.5);
            }
        });
        prune(this.pickup_sprites, seen, function(sprite) { sprite.destroy(); });

        if (own) {
            this.main_player.apply_server_state(own);
            // No permanent counters: HP drives the Atmosphere post pass,
            // and the quiver readout only surfaces when the count changes.
            this.current_ammo = own.ammo;
            if (this.last_known_ammo === null) {
                this.last_known_ammo = own.ammo;
            }
            else if (own.ammo !== this.last_known_ammo) {
                this.last_known_ammo = own.ammo;
                this.show_ammo_until = this.game.time.now + 1500;
                this.refresh_ammo_display();
            }
            if (!own.alive) {
                this.hud_dead.setText(spaced('YOU ARE DOWN'));
                this.hud_dead_sub.setText('the others can bring you back when the next wave comes');
            }
            else {
                this.hud_dead.setText('');
                this.hud_dead_sub.setText('');
            }
        }

        // Wave text marks transitions only; the text itself persists (for
        // the HUD checks) but its alpha dies away between transitions.
        if (snapshot.wave.intermission > 0) {
            this.hud_wave.setText('the dead come again in ' + Math.ceil(snapshot.wave.intermission / 1000));
            this.wave_text_until = this.game.time.now + 600;
        }
        else if (snapshot.wave.number > 0 && snapshot.wave.number !== this.wave_shown_number) {
            this.wave_shown_number = snapshot.wave.number;
            this.hud_wave.setText(spaced('WAVE ' + snapshot.wave.number));
            this.wave_text_until = this.game.time.now + 3500;
        }

        snapshot.events.forEach(function(event_text) {
            self.display_new_message(event_text);
        });
    },
    show_disconnected: function() {
        if (this.hud_dead) {
            this.hud_dead.setText(spaced('CONNECTION LOST'));
        }
    },
    display_new_message: function(text) {
        // Grim, minimal feed: small dim serif lines, bottom-left, that
        // sink into the dark after a few seconds (see update_hud).
        if (this.displayed_messages.length >= 5) {
            var oldest = this.displayed_messages.shift();
            oldest.destroy();
        }
        this.displayed_messages.forEach(function(message) {
            message.cameraOffset.y -= 16;
        });
        var new_message = this.game.add.text(14, this.game.camera.height - 28, text, {
            font: "italic 11px Georgia, 'Times New Roman', serif", fill: "#6f6a5e"
        });
        new_message.setShadow(1, 1, 'rgba(0,0,0,0.85)', 3);
        new_message.fixedToCamera = true;
        new_message.alpha = 0.8;
        new_message.born_at = this.game.time.now;
        this.displayed_messages.push(new_message);
    }
};

// Letter-space a line the cheap way; Phaser 2 text has no letterSpacing.
function spaced(text) {
    return text.split('').join(' ');
}

function prune(map, seen, destroy) {
    for (var id in map) {
        if (!seen[id]) {
            destroy(map[id]);
            delete map[id];
        }
    }
}

function lerp_angle(a, b, t) {
    var d = b - a;
    while (d > Math.PI) { d -= Math.PI * 2; }
    while (d < -Math.PI) { d += Math.PI * 2; }
    return a + d * t;
}

/* ---- Programmatic zombie art. All frames face +x; pose swings limbs. ---- */

function draw_zombie_frame(ctx, kind, cx, cy, pose) {
    if (kind === 'runner') { draw_runner_frame(ctx, cx, cy, pose); }
    else if (kind === 'crawler') { draw_crawler_frame(ctx, cx, cy, pose); }
    else { draw_walker_frame(ctx, cx, cy, pose); }
}

// Walker: broad, hunched, arms groping ahead — the slow relentless mass.
function draw_walker_frame(ctx, cx, cy, pose) {
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    zf_ellipse(ctx, cx - 1, cy + 2, 13, 10);
    // Feet shuffle behind the torso.
    ctx.fillStyle = '#23261f';
    zf_ellipse(ctx, cx - 8 + pose * 3, cy - 5, 4.5, 3.2);
    zf_ellipse(ctx, cx - 8 - pose * 3, cy + 5, 4.5, 3.2);
    // Arms out, groping.
    zf_limb(ctx, cx + 3, cy - 8, cx + 14, cy - (5 + pose * 2.5), 5, '#76806a');
    zf_limb(ctx, cx + 3, cy + 8, cx + 14, cy + (5 - pose * 2.5), 5, '#76806a');
    ctx.fillStyle = '#828c74';
    zf_ellipse(ctx, cx + 15, cy - (5 + pose * 2.5), 2.6, 2.6);
    zf_ellipse(ctx, cx + 15, cy + (5 - pose * 2.5), 2.6, 2.6);
    ctx.fillStyle = 'rgba(120,20,14,0.85)';
    zf_ellipse(ctx, cx + 16.5, cy - (5 + pose * 2.5), 1.3, 1.3);
    zf_ellipse(ctx, cx + 16.5, cy + (5 - pose * 2.5), 1.3, 1.3);
    // Ragged dark coat.
    ctx.fillStyle = '#31352c';
    zf_ellipse(ctx, cx, cy, 10.5, 8.5);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    zf_ellipse(ctx, cx + 3, cy - 3, 5, 3.5);
    ctx.fillStyle = 'rgba(96,14,10,0.8)';
    zf_ellipse(ctx, cx + 1, cy + 3, 3.6, 2.4);
    // Head lolls with the shamble.
    ctx.fillStyle = '#87907b';
    zf_ellipse(ctx, cx + 7.5, cy + pose * 1.4, 4.6, 4.6);
    ctx.fillStyle = '#2a2d26';
    ctx.beginPath();
    ctx.arc(cx + 7.5, cy + pose * 1.4, 4.6, Math.PI * 0.6, Math.PI * 1.4);
    ctx.fill();
    ctx.fillStyle = 'rgba(110,16,10,0.85)';
    zf_ellipse(ctx, cx + 11, cy + pose * 1.4 + 1, 1.6, 1.2);
}

// Runner: lean, low, stride thrown long, arms clawing far ahead.
function draw_runner_frame(ctx, cx, cy, pose) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    zf_ellipse(ctx, cx - 1, cy + 2, 12, 8);
    ctx.fillStyle = '#262a24';
    zf_ellipse(ctx, cx - 10 + pose * 5.5, cy - 4.5, 5.2, 3);
    zf_ellipse(ctx, cx - 10 - pose * 5.5, cy + 4.5, 5.2, 3);
    zf_limb(ctx, cx + 2, cy - 6.5, cx + 17, cy - (3 + pose * 2), 4.2, '#8b8371');
    zf_limb(ctx, cx + 2, cy + 6.5, cx + 17, cy + (3 - pose * 2), 4.2, '#8b8371');
    ctx.fillStyle = '#948b76';
    zf_ellipse(ctx, cx + 18, cy - (3 + pose * 2), 2.3, 2.3);
    zf_ellipse(ctx, cx + 18, cy + (3 - pose * 2), 2.3, 2.3);
    // Lean torso, torn shirt, ribs showing.
    ctx.fillStyle = '#463d33';
    zf_ellipse(ctx, cx, cy, 9.5, 6.6);
    ctx.fillStyle = 'rgba(150,140,120,0.25)';
    zf_ellipse(ctx, cx - 2, cy - 2, 3, 1.6);
    ctx.fillStyle = 'rgba(96,14,10,0.85)';
    zf_ellipse(ctx, cx - 1, cy + 2.5, 3, 1.8);
    // Head thrust forward.
    ctx.fillStyle = '#948b76';
    zf_ellipse(ctx, cx + 9, cy + pose * 0.8, 4.2, 4.2);
    ctx.fillStyle = 'rgba(110,16,10,0.9)';
    zf_ellipse(ctx, cx + 12.3, cy + pose * 0.8 + 0.8, 1.6, 1.2);
}

// Crawler: prone, one leg gone, hauling itself along a blood smear.
function draw_crawler_frame(ctx, cx, cy, pose) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    zf_ellipse(ctx, cx - 2, cy + 1, 15, 8);
    var smear = ctx.createLinearGradient(cx - 23, cy, cx - 4, cy);
    smear.addColorStop(0, 'rgba(80,10,8,0)');
    smear.addColorStop(1, 'rgba(80,10,8,0.4)');
    ctx.fillStyle = smear;
    ctx.fillRect(cx - 23, cy - 3.5, 19, 7);
    // One dragging leg, one ragged stump.
    zf_limb(ctx, cx - 5, cy + 2, cx - 17, cy + 6 - pose * 2, 4.5, '#3d4034');
    zf_limb(ctx, cx - 5, cy - 2, cx - 12, cy - 5, 5, '#3d4034');
    ctx.fillStyle = 'rgba(110,14,10,0.9)';
    zf_ellipse(ctx, cx - 12.5, cy - 5.2, 2.4, 2);
    // Arms splayed wide, hauling.
    zf_limb(ctx, cx + 5, cy - 5, cx + 14 + pose * 3.5, cy - 9, 4, '#6e6f5c');
    zf_limb(ctx, cx + 5, cy + 5, cx + 14 - pose * 3.5, cy + 9, 4, '#6e6f5c');
    ctx.fillStyle = '#79795f';
    zf_ellipse(ctx, cx + 15 + pose * 3.5, cy - 9.5, 2.2, 2.2);
    zf_ellipse(ctx, cx + 15 - pose * 3.5, cy + 9.5, 2.2, 2.2);
    // Low flat torso, spine knuckles showing.
    ctx.fillStyle = '#5f6252';
    zf_ellipse(ctx, cx - 1, cy, 11, 6.4);
    ctx.fillStyle = 'rgba(30,32,26,0.8)';
    for (var s = -7; s <= 5; s += 3) { zf_ellipse(ctx, cx - 1 + s, cy, 1.1, 1.6); }
    ctx.fillStyle = 'rgba(96,14,10,0.7)';
    zf_ellipse(ctx, cx - 4, cy + 2.5, 3, 2);
    // Head low, tilted up at you.
    ctx.fillStyle = '#7f836d';
    zf_ellipse(ctx, cx + 10, cy + pose * 1.2, 4, 4);
    ctx.fillStyle = 'rgba(110,16,10,0.9)';
    zf_ellipse(ctx, cx + 13.2, cy + pose * 1.2 + 0.6, 1.5, 1.1);
}

function zf_ellipse(ctx, x, y, rx, ry) {
    ctx.beginPath();
    if (ctx.ellipse) { ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); }
    else {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, ry / rx);
        ctx.arc(0, 0, rx, 0, Math.PI * 2);
        ctx.restore();
    }
    ctx.fill();
}

function zf_limb(ctx, x1, y1, x2, y2, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
}
