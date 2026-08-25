/*
 * Authoritative co-op survival game server.
 * Simulates zombies, waves, projectiles and pickups, and broadcasts
 * snapshots to every connected client over the shared WebSocket server.
 */

var WORLD_WIDTH = 1600;
var WORLD_HEIGHT = 1200;
var TICK_MS = 50; // 20Hz simulation
var SNAPSHOT_MS = 66; // ~15Hz broadcast

var PLAYER_MAX_HP = 100;
var PLAYER_START_AMMO = 15;
var PLAYER_SPEED = 220;

var ZOMBIE_BASE_HP = 100;
var ZOMBIE_SPEED_MIN = 45;
var ZOMBIE_SPEED_MAX = 80;
var ZOMBIE_ATTACK_RANGE = 30;
var ZOMBIE_DAMAGE = 10;
var ZOMBIE_ATTACK_COOLDOWN_MS = 1000;

var PROJECTILE_SPEED = 600;
var PROJECTILE_TTL_MS = 1500;
var PROJECTILE_DAMAGE = 34;
var PROJECTILE_HIT_RADIUS = 20;

var MELEE_RANGE = 55;
var MELEE_DAMAGE = 25;
var MELEE_COOLDOWN_MS = 700;
var MELEE_KNOCKBACK = 60;
var MELEE_STAMINA_COST = 30;
var STAMINA_MAX = 100;
var STAMINA_REGEN_PER_S = 16;

var WAVE_INTERMISSION_MS = 6000;

// Respawn tokens (M4): death is sticky. The group earns one token per
// KILLS_PER_TOKEN zombies put down; each token buys one fallen survivor
// back at the start of the next wave. No token, no coming back.
var KILLS_PER_TOKEN = 10;

// Supply drops (M3): resupply is an event, not litter. Every few waves a
// helicopter marks a drop point with a flare, and the crate that lands
// carries arrows, meds, boards — and the only cure for infection.
var SUPPLY_DROP_EVERY_WAVES = 3;
var SUPPLY_FLARE_MS = 6000;
var SUPPLY_LIFETIME_MS = 60000;
var SUPPLY_AMMO = 12;
var SUPPLY_HP = 40;
var SUPPLY_BOARDS = 2;

// Infection (M8): a bite can infect. The fever creeps for two minutes —
// vision closing in — and then you turn, right there, next to your friends.
// Only the infected player is shown their own state; telling the team is
// their choice.
var INFECTION_CHANCE = 0.1;
var INFECTION_FULL_MS = 120000;
var INFECTION_FEVER_FROM = 0.4;
var INFECTION_FEVER_HP = 2;
var INFECTION_FEVER_EVERY_MS = 5000;

// Wounds (M9): a bad bite can open a bleeder — bleeding is a state, not a
// number going down. HP drips away and the wound marks the ground behind
// you until a bandage is pressed to it (H) or a first aid kit closes it.
// Bandages come from supply drops and start in every survivor's pocket.
var BLEED_CHANCE = 0.3;
var BLEED_HP = 2;
var BLEED_EVERY_MS = 2500;
var PLAYER_START_BANDAGES = 1;
var SUPPLY_BANDAGES = 2;
var BANDAGE_HEAL = 10;

// Barricading (M5): boards come from supply drops; B nails one up in front
// of you. Barricades stop zombies (never survivors), and the horde tears
// through them given time.
var PLAYER_START_BOARDS = 2;
var BARRICADE_HP = 140;
var BARRICADE_RADIUS = 24;
var BARRICADE_PLACE_DIST = 34;
var BARRICADE_COOLDOWN_MS = 900;

var PLAYER_RADIUS = 14;
var MAX_PLAYERS = 8;            // M12: up to eight survivors, like the bar

// Mid-wave revival (M12): co-op means hands on a fallen teammate. A living
// survivor standing over a downed one spends REVIVE_MS of exposure and one
// respawn token to drag them back up mid-wave — kneeling next to a body
// while the horde closes is the co-op tension the bar is built on.
var REVIVE_RANGE = 44;
var REVIVE_MS = 2500;
var REVIVE_HP = 30;

// Safe zones (M1): sandbagged positions the group is defending — the
// Survival-mode objective. Part of the horde goes for them, not for you;
// an overrun zone stays overrun, thickens every later wave, and stops
// hosting supply drops. Integrity is the ZONE A/B percentage on the HUD.
var ZONES = [
    { id: 'A', x: 560, y: 500, r: 62 },
    { id: 'B', x: 1040, y: 742, r: 62 }
];
var ZONE_SAPPER_CHANCE = 0.3;   // share of spawns that go for a zone
var ZONE_BITE = 1.5;            // integrity chewed per zombie attack
var ZONE_DEFEND_RADIUS = 240;   // a nearby survivor pulls sappers off the zone
var ZONE_OVERRUN_WAVE_PENALTY = 3;

// The horde is not one shape: walkers shamble in mass, runners sprint and
// terrify, crawlers drag themselves low and get underfoot.
var ZOMBIE_KINDS = {
    walker:  { speed_min: 40, speed_max: 58,  hp_base: 100, hp_per_wave: 10, damage: 8, attack_range: 30, radius: 13 },
    runner:  { speed_min: 100, speed_max: 130, hp_base: 55, hp_per_wave: 6,  damage: 7, attack_range: 28, radius: 11 },
    crawler: { speed_min: 30, speed_max: 44,  hp_base: 40,  hp_per_wave: 5,  damage: 5, attack_range: 24, radius: 9 }
};

// A ruined crossroads. Roads are for the clients to paint; obstacles are
// solid — players, zombies and arrows all collide with them server-side.
var MAP_ROADS = [
    { x: 0, y: 540, w: 1600, h: 160 },
    { x: 720, y: 0, w: 160, h: 1200 }
];
var MAP_OBSTACLES = [
    // Buildings, four decayed blocks around the intersection.
    { x: 80, y: 80, w: 280, h: 200, kind: 'building' },
    { x: 440, y: 60, w: 220, h: 160, kind: 'building' },
    { x: 120, y: 340, w: 180, h: 140, kind: 'building' },
    { x: 420, y: 300, w: 240, h: 180, kind: 'building' },
    { x: 960, y: 90, w: 260, h: 180, kind: 'building' },
    { x: 1290, y: 70, w: 230, h: 200, kind: 'building' },
    { x: 1000, y: 330, w: 200, h: 150, kind: 'building' },
    { x: 1280, y: 340, w: 240, h: 160, kind: 'building' },
    { x: 90, y: 760, w: 240, h: 180, kind: 'building' },
    { x: 420, y: 780, w: 220, h: 160, kind: 'building' },
    { x: 120, y: 1000, w: 200, h: 130, kind: 'building' },
    { x: 430, y: 1000, w: 230, h: 140, kind: 'building' },
    { x: 980, y: 760, w: 250, h: 170, kind: 'building' },
    { x: 1300, y: 740, w: 220, h: 190, kind: 'building' },
    { x: 1010, y: 1000, w: 210, h: 130, kind: 'building' },
    { x: 1300, y: 1000, w: 220, h: 130, kind: 'building' },
    // Dead vehicles abandoned on the roads.
    { x: 565, y: 588, w: 78, h: 36, kind: 'car' },
    { x: 1024, y: 612, w: 78, h: 36, kind: 'car' },
    { x: 300, y: 634, w: 80, h: 34, kind: 'car' },
    { x: 1272, y: 566, w: 118, h: 38, kind: 'bus' },
    { x: 762, y: 284, w: 40, h: 82, kind: 'car_v' },
    { x: 788, y: 872, w: 42, h: 88, kind: 'van_v' },
    // Alley dumpsters.
    { x: 672, y: 150, w: 40, h: 26, kind: 'dumpster' },
    { x: 918, y: 250, w: 40, h: 26, kind: 'dumpster' },
    { x: 672, y: 940, w: 40, h: 26, kind: 'dumpster' },
    { x: 930, y: 1035, w: 40, h: 26, kind: 'dumpster' }
];

// Push a circle out of every solid rect (slides along faces).
function collide_circle_obstacles(x, y, radius) {
    for (var i = 0; i < MAP_OBSTACLES.length; i++) {
        var o = MAP_OBSTACLES[i];
        var nearest_x = clamp(x, o.x, o.x + o.w);
        var nearest_y = clamp(y, o.y, o.y + o.h);
        var dx = x - nearest_x;
        var dy = y - nearest_y;
        var d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) { continue; }
        if (d2 > 0.0001) {
            var d = Math.sqrt(d2);
            x = nearest_x + (dx / d) * radius;
            y = nearest_y + (dy / d) * radius;
        }
        else {
            // Center inside the rect: exit through the nearest face.
            var left = x - o.x, right = o.x + o.w - x;
            var top = y - o.y, bottom = o.y + o.h - y;
            var m = Math.min(left, right, top, bottom);
            if (m === left) { x = o.x - radius; }
            else if (m === right) { x = o.x + o.w + radius; }
            else if (m === top) { y = o.y - radius; }
            else { y = o.y + o.h + radius; }
        }
    }
    return { x: x, y: y };
}

function point_blocked(x, y) {
    for (var i = 0; i < MAP_OBSTACLES.length; i++) {
        var o = MAP_OBSTACLES[i];
        if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) { return true; }
    }
    return false;
}

function Game_Server() {
    this.players = {}; // id -> player
    this.zombies = {}; // id -> zombie
    this.projectiles = {};
    this.pickups = {};
    this.next_id = 1;
    this.wave = 0;
    this.zombies_to_spawn = 0;
    // Armed by the wave logic once someone is actually playing — arming it
    // at boot would let it expire while the server sits empty and dump
    // wave 1 on the first player the instant they join.
    this.intermission_until = null;
    this.spawn_accumulator = 0;
    this.kills = 0;             // group total; every KILLS_PER_TOKEN earns a token
    this.respawn_tokens = 0;
    this.last_drop_wave = 0;    // the wave whose start last called in the helicopter
    this.force_revive_all = false; // set on a group wipe: the replayed wave starts whole
    this.supply_drop = null;    // {x,y,state:'incoming'|'landed',lands_at,expires,claimed}
    this.barricades = {};       // id -> {id,x,y,rotation,hp,max_hp}
    this.zones = ZONES.map(function(z) {
        return { id: z.id, x: z.x, y: z.y, r: z.r, integrity: 100, overrun: false };
    });
    this.events = [];
    this.deaths = []; // gore feed: where zombies fell this snapshot, for corpse decals
    this.hits = [];   // gore feed: non-fatal wounds this snapshot, for blood decals
    this.shots = [];  // combat feed: bow releases this snapshot, for release-flash effects
    this.shoves = []; // combat feed: melee shoves this snapshot, for the visible arc
    this.sockets = {}; // id -> ws
}

Game_Server.prototype.start = function() {
    var self = this;
    this.tick_timer = setInterval(function() { self.tick(TICK_MS / 1000); }, TICK_MS);
    this.snapshot_timer = setInterval(function() { self.broadcast_snapshot(); }, SNAPSHOT_MS);
};

Game_Server.prototype.handle_connection = function(ws) {
    var self = this;
    var id = 'p' + (this.next_id++);
    this.sockets[id] = ws;

    ws.on('message', function(raw) {
        var message;
        try {
            message = JSON.parse(raw);
        } catch (e) {
            return;
        }
        if (!message || typeof message !== 'object') {
            return;
        }
        self.handle_message(id, message);
    });

    ws.on('close', function() {
        var player = self.players[id];
        if (player) {
            self.events.push(player.name + ' left the group.');
        }
        delete self.players[id];
        delete self.sockets[id];
    });

    ws.on('error', function() {});
};

Game_Server.prototype.handle_message = function(id, message) {
    var player = this.players[id];
    switch (message.type) {
        case 'join':
            // One player per connection; a repeat join must not respawn or
            // reset an existing player mid-game.
            if (!player) {
                this.spawn_player(id, message.name);
            }
            break;
        case 'move':
            if (player && player.alive) {
                var now = Date.now();
                var dt = Math.min(0.5, (now - (player.last_move_time || now)) / 1000);
                player.last_move_time = now;
                // Movement stays server-validated with a distance allowance
                // that accrues with real elapsed time (slack for jitter) and
                // is spent by actual displacement. A fixed per-message floor
                // would let a spammed message stream teleport the player.
                player.move_allowance = Math.min(60,
                    (player.move_allowance || 0) + PLAYER_SPEED * dt * 1.25);
                var max_step = player.move_allowance;
                var target_x = clamp(Number(message.x) || 0, 0, WORLD_WIDTH);
                var target_y = clamp(Number(message.y) || 0, 0, WORLD_HEIGHT);
                var dx = target_x - player.x;
                var dy = target_y - player.y;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > max_step) {
                    var scale = max_step / dist;
                    target_x = player.x + dx * scale;
                    target_y = player.y + dy * scale;
                }
                var resolved = collide_circle_obstacles(target_x, target_y, PLAYER_RADIUS);
                var spent_x = resolved.x - player.x;
                var spent_y = resolved.y - player.y;
                player.move_allowance = Math.max(0,
                    player.move_allowance - Math.sqrt(spent_x * spent_x + spent_y * spent_y));
                player.x = resolved.x;
                player.y = resolved.y;
                // Reject non-finite rotation: Infinity/NaN would flow through
                // cos/sin into projectile velocities and barricade positions as
                // NaN and durably corrupt snapshots. (Number(x) || 0 lets
                // Infinity through because it is truthy, so guard explicitly.)
                var rot = Number(message.rotation);
                player.rotation = isFinite(rot) ? rot : 0;
            }
            break;
        case 'shoot':
            if (player && player.alive) {
                this.player_shoot(player);
            }
            break;
        case 'melee':
            if (player && player.alive) {
                this.player_melee(player, 'shove');
            }
            break;
        case 'swing':
            if (player && player.alive) {
                this.player_melee(player, 'swing');
            }
            break;
        case 'barricade':
            if (player && player.alive) {
                this.player_barricade(player);
            }
            break;
        case 'bandage':
            if (player && player.alive) {
                this.player_bandage(player);
            }
            break;
    }
};

Game_Server.prototype.spawn_player = function(id, name) {
    if (Object.keys(this.players).length >= MAX_PLAYERS) {
        var full_ws = this.sockets[id];
        if (full_ws && full_ws.readyState === 1) {
            full_ws.send(JSON.stringify({ type: 'full', max: MAX_PLAYERS }));
        }
        return;
    }
    name = String(name || 'Survivor').slice(0, 20);
    // Joining an abandoned world: the leftover horde has converged on the
    // spawn by now and would ambush the new group instantly. Let it move
    // on and replay the wave after a breather.
    if (Object.keys(this.players).length === 0 &&
        (Object.keys(this.zombies).length > 0 || this.zombies_to_spawn > 0)) {
        this.zombies = {};
        this.projectiles = {};
        this.zombies_to_spawn = 0;
        this.wave = Math.max(0, this.wave - 1);
        this.intermission_until = Date.now() + WAVE_INTERMISSION_MS;
    }
    this.players[id] = {
        id: id,
        name: name,
        x: WORLD_WIDTH / 2 + (Math.random() * 120 - 60),
        y: WORLD_HEIGHT / 2 + (Math.random() * 120 - 60),
        rotation: 0,
        hp: PLAYER_MAX_HP,
        ammo: PLAYER_START_AMMO,
        alive: true,
        last_melee: 0,
        last_shot: 0,
        move_allowance: 40,
        stamina: STAMINA_MAX,
        boards: PLAYER_START_BOARDS,
        last_barricade: 0,
        infected: false,
        infection: 0,
        infected_at: 0,
        last_fever: 0,
        bleeding: false,
        last_bleed: 0,
        bandages: PLAYER_START_BANDAGES
    };
    this.events.push(name + ' joined the group. Survive together.');
    var ws = this.sockets[id];
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'welcome',
            id: id,
            world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
            map: { roads: MAP_ROADS, obstacles: MAP_OBSTACLES, zones: ZONES }
        }));
    }
};

Game_Server.prototype.player_shoot = function(player) {
    if (player.ammo <= 0) {
        return;
    }
    // The bow's draw time is authoritative here, not in the client's input
    // handler — a hostile client spamming shoot messages must not turn a
    // bow into a machine gun.
    var now = Date.now();
    if (now - (player.last_shot || 0) < 240) {
        return;
    }
    player.last_shot = now;
    player.ammo -= 1;
    var pid = 'a' + (this.next_id++);
    this.projectiles[pid] = {
        id: pid,
        x: player.x,
        y: player.y,
        rotation: player.rotation,
        vx: Math.cos(player.rotation) * PROJECTILE_SPEED,
        vy: Math.sin(player.rotation) * PROJECTILE_SPEED,
        owner: player.id,
        expires: Date.now() + PROJECTILE_TTL_MS
    };
    // Combat feed: every client renders the release (flash, shake) even
    // for shots fired by someone across the street.
    if (this.shots.length < 40) {
        this.shots.push({
            id: player.id,
            x: Math.round(player.x),
            y: Math.round(player.y),
            rotation: Math.round(player.rotation * 100) / 100
        });
    }
};

// NMRiH separates the two melee intents: the SHOVE (F) is non-lethal — a
// frontal push that buys space cheaply — while the SWING (V) is the
// committed kill: narrower, slower, expensive, and it ends things. Both
// are directional now: what's behind you stays behind you.
Game_Server.prototype.player_melee = function(player, mode) {
    var swing = mode === 'swing';
    var now = Date.now();
    var cooldown = swing ? 950 : MELEE_COOLDOWN_MS;
    var cost = swing ? 38 : 22;
    if (now - player.last_melee < cooldown) {
        return;
    }
    // Melee costs something: swing on an empty tank and nothing happens.
    if ((player.stamina || 0) < cost) {
        return;
    }
    player.stamina -= cost;
    player.last_melee = now;
    var half_arc = swing ? 0.6 : 1.05;
    var damage = swing ? 40 : 6;
    var knockback = swing ? 24 : MELEE_KNOCKBACK;
    var connected = 0;
    for (var zid in this.zombies) {
        var zombie = this.zombies[zid];
        var dx = zombie.x - player.x;
        var dy = zombie.y - player.y;
        if (dx * dx + dy * dy > MELEE_RANGE * MELEE_RANGE) { continue; }
        var to_zombie = Math.atan2(dy, dx);
        var off = Math.abs(angle_diff(to_zombie, player.rotation));
        if (off > half_arc) { continue; }
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var kicked = collide_circle_obstacles(
            clamp(zombie.x + (dx / dist) * knockback, 0, WORLD_WIDTH),
            clamp(zombie.y + (dy / dist) * knockback, 0, WORLD_HEIGHT),
            zombie.radius || 12);
        zombie.x = kicked.x;
        zombie.y = kicked.y;
        connected += 1;
        this.damage_zombie(zombie, damage, player, to_zombie);
    }
    // Combat feed: the swing itself is visible to everyone — an arc in
    // front of the attacker — whether or not it connected.
    if (this.shoves.length < 40) {
        this.shoves.push({
            id: player.id,
            x: Math.round(player.x),
            y: Math.round(player.y),
            rotation: Math.round(player.rotation * 100) / 100,
            connected: connected,
            swing: swing ? 1 : 0
        });
    }
};

function angle_diff(a, b) {
    var d = a - b;
    while (d > Math.PI) { d -= Math.PI * 2; }
    while (d < -Math.PI) { d += Math.PI * 2; }
    return d;
}

Game_Server.prototype.player_bandage = function(player) {
    // Pressing a bandage to a wound (H): stops a bleed and closes a little
    // of the damage. Wasting one on an unbroken skin is refused.
    if ((player.bandages || 0) <= 0) { return; }
    if (!player.bleeding && player.hp >= PLAYER_MAX_HP) { return; }
    player.bandages -= 1;
    var was_bleeding = player.bleeding;
    player.bleeding = false;
    player.hp = Math.min(PLAYER_MAX_HP, player.hp + BANDAGE_HEAL);
    this.events.push(player.name + (was_bleeding ?
        ' pressed a bandage to the wound.' : ' wrapped a bandage tight.'));
};

Game_Server.prototype.player_barricade = function(player) {
    var now = Date.now();
    if ((player.boards || 0) <= 0) { return; }
    if (now - (player.last_barricade || 0) < BARRICADE_COOLDOWN_MS) { return; }
    // Nail the boards up an arm's length ahead, across your facing.
    var bx = clamp(player.x + Math.cos(player.rotation) * BARRICADE_PLACE_DIST, 30, WORLD_WIDTH - 30);
    var by = clamp(player.y + Math.sin(player.rotation) * BARRICADE_PLACE_DIST, 30, WORLD_HEIGHT - 30);
    if (point_blocked(bx, by)) { return; }
    for (var id in this.barricades) {
        var other = this.barricades[id];
        var dx = other.x - bx, dy = other.y - by;
        if (dx * dx + dy * dy < (BARRICADE_RADIUS * 1.6) * (BARRICADE_RADIUS * 1.6)) { return; }
    }
    player.boards -= 1;
    player.last_barricade = now;
    var bid = 'b' + (this.next_id++);
    this.barricades[bid] = {
        id: bid,
        x: bx,
        y: by,
        rotation: player.rotation + Math.PI / 2,
        hp: BARRICADE_HP,
        max_hp: BARRICADE_HP
    };
    this.events.push(player.name + ' nailed boards across the gap.');
};

Game_Server.prototype.nearest_touching_barricade = function(x, y, reach) {
    var best = null, best_d2 = Infinity;
    for (var id in this.barricades) {
        var b = this.barricades[id];
        var dx = b.x - x, dy = b.y - y;
        var d2 = dx * dx + dy * dy;
        var limit = BARRICADE_RADIUS + reach;
        if (d2 <= limit * limit && d2 < best_d2) { best = b; best_d2 = d2; }
    }
    return best;
};

// Zombies (never survivors) are pushed back out of barricade circles.
Game_Server.prototype.collide_circle_barricades = function(x, y, radius) {
    for (var id in this.barricades) {
        var b = this.barricades[id];
        var dx = x - b.x, dy = y - b.y;
        var min_dist = BARRICADE_RADIUS + radius;
        var d2 = dx * dx + dy * dy;
        if (d2 >= min_dist * min_dist) { continue; }
        var d = Math.sqrt(d2) || 1;
        x = b.x + (dx / d) * min_dist;
        y = b.y + (dy / d) * min_dist;
    }
    return { x: x, y: y };
};

Game_Server.prototype.damage_barricade = function(barricade, amount) {
    barricade.hp -= amount;
    if (barricade.hp <= 0) {
        delete this.barricades[barricade.id];
        this.events.push('The horde tore a barricade apart.');
    }
};

Game_Server.prototype.damage_zombie = function(zombie, amount, player, dir) {
    zombie.hp -= amount;
    // Impact direction rides along so clients can spray blood through the
    // wound and flinch/fell the body away from the blow.
    var impact_dir = typeof dir === 'number' ? Math.round(dir * 100) / 100 : null;
    if (zombie.hp <= 0) {
        delete this.zombies[zombie.id];
        // The kill leaves a mark on the world: clients stamp a persistent
        // corpse and blood pool where it dropped.
        if (this.deaths.length < 40) {
            this.deaths.push({ x: Math.round(zombie.x), y: Math.round(zombie.y), kind: zombie.kind || 'walker', dir: impact_dir });
        }
        this.events.push(player.name + ' put one down.');
        // Kills are the group's currency: every KILLS_PER_TOKEN buys one
        // fallen survivor back at the next wave.
        this.kills += 1;
        if (this.kills % KILLS_PER_TOKEN === 0) {
            this.respawn_tokens += 1;
            this.events.push(this.kills + ' put down — the group earned a respawn token.');
        }
        // Scavenge is rare litter now; the supply drop is the real resupply.
        if (Math.random() < 0.12) {
            this.spawn_pickup(zombie.x, zombie.y);
        }
    }
    else if (this.hits.length < 40) {
        this.hits.push({ x: Math.round(zombie.x), y: Math.round(zombie.y), id: zombie.id, dir: impact_dir });
    }
};

Game_Server.prototype.spawn_pickup = function(x, y) {
    // Keep supplies out of the buildings and wrecks.
    for (var tries = 0; tries < 25 && point_blocked(x, y); tries++) {
        x = 80 + Math.random() * (WORLD_WIDTH - 160);
        y = 80 + Math.random() * (WORLD_HEIGHT - 160);
    }
    var id = 'k' + (this.next_id++);
    this.pickups[id] = {
        id: id,
        x: clamp(x, 40, WORLD_WIDTH - 40),
        y: clamp(y, 40, WORLD_HEIGHT - 40),
        kind: Math.random() < 0.6 ? 'ammo' : 'health',
        // Unclaimed drops rot away rather than accumulating forever.
        expires: Date.now() + 45000
    };
};

Game_Server.prototype.start_wave = function() {
    this.wave += 1;
    // Horde density: enough bodies that the streets fill up. Every zone
    // the dead hold makes the next wave heavier.
    var overrun_count = 0;
    for (var zi = 0; zi < this.zones.length; zi++) {
        if (this.zones[zi].overrun) { overrun_count += 1; }
    }
    this.zombies_to_spawn = 10 + this.wave * 5 + overrun_count * ZONE_OVERRUN_WAVE_PENALTY;
    this.events.push('Wave ' + this.wave + ' — they are coming...');
    // Death is sticky: a fallen survivor only gets back up if the group has
    // a respawn token to spend on them (a wipe replays the wave whole).
    for (var id in this.players) {
        var player = this.players[id];
        if (!player.alive) {
            if (!this.force_revive_all && this.respawn_tokens <= 0) { continue; }
            if (!this.force_revive_all) {
                this.respawn_tokens -= 1;
                this.events.push('A respawn token was spent — ' + player.name + ' is back on their feet.');
            }
            player.alive = true;
            player.hp = Math.floor(PLAYER_MAX_HP / 2);
            player.ammo = Math.max(player.ammo, 8);
            player.infected = false;
            player.infection = 0;
            player.bleeding = false;
            player.x = WORLD_WIDTH / 2;
            player.y = WORLD_HEIGHT / 2;
        }
    }
    this.force_revive_all = false;
    // The helicopter comes early once (wave 2, so a young group actually
    // sees a drop) and then every SUPPLY_DROP_EVERY_WAVES waves after the
    // last one: resupply is an event you fight toward, not litter. Tracking
    // the last drop's wave keeps a skipped or lingering crate from silently
    // cancelling all future drops.
    var due = this.last_drop_wave === 0
        ? this.wave >= 2
        : this.wave - this.last_drop_wave >= SUPPLY_DROP_EVERY_WAVES;
    if (due && !this.supply_drop) {
        this.last_drop_wave = this.wave;
        this.schedule_supply_drop();
    }
};

Game_Server.prototype.schedule_supply_drop = function() {
    // The helicopter drops on a zone the group still holds — defending the
    // sandbags is what keeps the supplies coming. Overrun everything and
    // the drops land wherever out on the streets.
    var x = 0, y = 0, ok = false;
    var zone = this.nearest_standing_zone(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    if (zone) {
        x = zone.x + (Math.random() - 0.5) * 60;
        y = zone.y + (Math.random() - 0.5) * 60;
        ok = !point_blocked(x, y);
    }
    for (var tries = 0; tries < 40 && !ok; tries++) {
        x = WORLD_WIDTH / 2 + (Math.random() - 0.5) * 520;
        y = WORLD_HEIGHT / 2 + (Math.random() - 0.5) * 420;
        ok = !point_blocked(x, y);
    }
    if (!ok) { x = WORLD_WIDTH / 2; y = WORLD_HEIGHT / 2 + 90; }
    this.supply_drop = {
        x: Math.round(x),
        y: Math.round(y),
        state: 'incoming',
        lands_at: Date.now() + SUPPLY_FLARE_MS,
        expires: 0,
        claimed: {}
    };
    this.events.push('A helicopter thunders overhead — a flare marks the supply drop.');
};

Game_Server.prototype.tick_supply_drop = function(now) {
    var drop = this.supply_drop;
    if (!drop) { return; }
    if (drop.state === 'incoming') {
        if (now >= drop.lands_at) {
            drop.state = 'landed';
            drop.expires = now + SUPPLY_LIFETIME_MS;
            this.events.push('The supply crate is down. Stock up before the horde closes in.');
        }
        return;
    }
    // Landed: each survivor can stock up once — arrows, meds, boards, and
    // quietly, the cure if a bite is festering in them.
    var all_claimed = true;
    for (var pid in this.players) {
        var player = this.players[pid];
        if (!player.alive) {
            // A downed survivor hasn't claimed: the crate must wait for
            // them (they may be revived while it still sits there) rather
            // than be declared picked clean over their body.
            if (!drop.claimed[pid]) { all_claimed = false; }
            continue;
        }
        if (drop.claimed[pid]) { continue; }
        var dx = player.x - drop.x;
        var dy = player.y - drop.y;
        if (dx * dx + dy * dy <= 36 * 36) {
            drop.claimed[pid] = true;
            player.ammo += SUPPLY_AMMO;
            player.hp = Math.min(PLAYER_MAX_HP, player.hp + SUPPLY_HP);
            player.boards = (player.boards || 0) + SUPPLY_BOARDS;
            player.bandages = (player.bandages || 0) + SUPPLY_BANDAGES;
            player.bleeding = false; // the crate's meds close open wounds
            if (player.infected) {
                // The cure is taken in silence; nobody else has to know.
                player.infected = false;
                player.infection = 0;
            }
            this.events.push(player.name + ' stocked up at the supply crate.');
        }
        else {
            all_claimed = false;
        }
    }
    if ((all_claimed && Object.keys(this.players).length > 0) || now >= drop.expires) {
        this.supply_drop = null;
        this.events.push('The supply crate is picked clean.');
    }
};

Game_Server.prototype.pick_zombie_kind = function() {
    // Mostly shamblers early; runners and crawlers thicken the mix later.
    var runner_chance = this.wave >= 2 ? Math.min(0.32, 0.06 + this.wave * 0.04) : 0.08;
    var crawler_chance = this.wave >= 2 ? 0.18 : 0.12;
    var roll = Math.random();
    if (roll < runner_chance) { return 'runner'; }
    if (roll < runner_chance + crawler_chance) { return 'crawler'; }
    return 'walker';
};

// Where the next pack walks in from: a point on the world edge nearest a
// survivor (mostly), so the mass is SEEN approaching.
Game_Server.prototype.pick_spawn_point = function() {
    var edge = Math.floor(Math.random() * 4);
    var x = Math.random() * WORLD_WIDTH;
    var y = Math.random() * WORLD_HEIGHT;
    var alive_players = [];
    for (var pid in this.players) {
        if (this.players[pid].alive) { alive_players.push(this.players[pid]); }
    }
    if (alive_players.length > 0 && Math.random() < 0.85) {
        var mark = alive_players[Math.floor(Math.random() * alive_players.length)];
        x = clamp(mark.x + (Math.random() - 0.5) * 560, 0, WORLD_WIDTH);
        y = clamp(mark.y + (Math.random() - 0.5) * 560, 0, WORLD_HEIGHT);
        // Snap to the nearest edge from that point.
        var d_left = x, d_right = WORLD_WIDTH - x, d_top = y, d_bottom = WORLD_HEIGHT - y;
        var m = Math.min(d_left, d_right, d_top, d_bottom);
        if (m === d_left) { edge = 2; } else if (m === d_right) { edge = 3; }
        else if (m === d_top) { edge = 0; } else { edge = 1; }
    }
    if (edge === 0) { y = 0; }
    if (edge === 1) { y = WORLD_HEIGHT; }
    if (edge === 2) { x = 0; }
    if (edge === 3) { x = WORLD_WIDTH; }
    return { x: x, y: y };
};

Game_Server.prototype.spawn_zombie = function(origin) {
    var id = 'z' + (this.next_id++);
    var point = origin || this.pick_spawn_point();
    // Pack jitter: shoulder to shoulder around the pulse origin.
    var x = clamp(point.x + (Math.random() - 0.5) * 130, 0, WORLD_WIDTH);
    var y = clamp(point.y + (Math.random() - 0.5) * 130, 0, WORLD_HEIGHT);
    var kind = this.pick_zombie_kind();
    var stats = ZOMBIE_KINDS[kind];
    var max_hp = stats.hp_base + (this.wave - 1) * stats.hp_per_wave;
    this.zombies[id] = {
        id: id,
        kind: kind,
        x: x,
        y: y,
        hp: max_hp,
        max_hp: max_hp,
        speed: stats.speed_min + Math.random() * (stats.speed_max - stats.speed_min),
        damage: stats.damage,
        attack_range: stats.attack_range,
        radius: stats.radius,
        last_attack: 0,
        // A share of the horde goes for the sandbags, not the survivors.
        objective: Math.random() < ZONE_SAPPER_CHANCE ? 'zone' : 'player'
    };
};

Game_Server.prototype.tick = function(dt) {
    var now = Date.now();
    var player_count = Object.keys(this.players).length;

    // Wave management: only run the horde while someone is playing.
    if (player_count > 0) {
        var zombies_alive = Object.keys(this.zombies).length;

        // Group wipe: nobody left alive to fight. Clear the horde and replay
        // the wave after an intermission (start_wave revives everyone).
        var anyone_alive = false;
        for (var wid in this.players) {
            if (this.players[wid].alive) { anyone_alive = true; break; }
        }
        if (!anyone_alive && (zombies_alive > 0 || this.zombies_to_spawn > 0)) {
            this.zombies = {};
            this.projectiles = {};
            this.zombies_to_spawn = 0;
            zombies_alive = 0;
            this.wave = Math.max(0, this.wave - 1);
            this.intermission_until = now + WAVE_INTERMISSION_MS;
            this.force_revive_all = true; // the replayed wave starts whole...
            // ...but a wipe cannot be cheaper than a single death: the
            // group's earned tokens and token progress are gone with them.
            this.respawn_tokens = 0;
            this.kills = this.kills - (this.kills % KILLS_PER_TOKEN);
            this.events.push('The whole group went down. Every earned respawn is lost with them.');
        }
        if (this.zombies_to_spawn === 0 && zombies_alive === 0) {
            if (!this.intermission_until) {
                this.intermission_until = now + WAVE_INTERMISSION_MS;
                if (this.wave > 0) {
                    this.events.push('Wave ' + this.wave + ' cleared. Catch your breath.');
                }
            }
            else if (now >= this.intermission_until) {
                this.intermission_until = null;
                this.start_wave();
            }
        }
        else if (this.zombies_to_spawn > 0) {
            // The horde arrives in PULSES: a pack of bodies from one point,
            // walking together — a mass closing in, not a trickle of
            // stragglers from every compass direction.
            if (!this.pulse || this.pulse.remaining === 0) {
                if (!this.pulse || now >= this.pulse.cooldown_until) {
                    this.pulse = {
                        origin: this.pick_spawn_point(),
                        remaining: Math.min(6, this.zombies_to_spawn),
                        cooldown_until: now + 3200
                    };
                }
            }
            if (this.pulse && this.pulse.remaining > 0) {
                this.spawn_accumulator += dt;
                if (this.spawn_accumulator >= 0.12) {
                    this.spawn_accumulator = 0;
                    this.spawn_zombie(this.pulse.origin);
                    this.pulse.remaining -= 1;
                    this.zombies_to_spawn -= 1;
                    if (this.pulse.remaining === 0) {
                        this.pulse.cooldown_until = now + 3200;
                    }
                }
            }
        }
    }

    this.tick_players(dt, now);
    this.tick_zombies(dt, now);
    this.tick_projectiles(dt, now);
    this.tick_pickups();
    this.tick_supply_drop(now);
};

Game_Server.prototype.tick_players = function(dt, now) {
    for (var pid in this.players) {
        var player = this.players[pid];
        if (!player.alive) {
            // A living teammate over the body pulls them back up — costs
            // uninterrupted seconds in the open, and one token.
            if (this.respawn_tokens > 0) {
                var helper = null;
                for (var hid in this.players) {
                    var candidate = this.players[hid];
                    if (!candidate.alive || hid === pid) { continue; }
                    var hdx = candidate.x - player.x;
                    var hdy = candidate.y - player.y;
                    if (hdx * hdx + hdy * hdy <= REVIVE_RANGE * REVIVE_RANGE) { helper = candidate; break; }
                }
                if (helper) {
                    player.revive_progress = (player.revive_progress || 0) + dt * 1000;
                    if (player.revive_progress >= REVIVE_MS) {
                        player.revive_progress = 0;
                        this.respawn_tokens -= 1;
                        player.alive = true;
                        player.hp = REVIVE_HP;
                        this.events.push(helper.name + ' drags ' + player.name + ' back to their feet.');
                    }
                }
                else {
                    player.revive_progress = 0;
                }
            }
            continue;
        }
        player.stamina = Math.min(STAMINA_MAX, (player.stamina || 0) + STAMINA_REGEN_PER_S * dt);
        // An open bleeder drains on its own clock and drips a trail (the
        // hits feed stamps blood decals on every client) until it is
        // bandaged, patched with a kit, or it finishes you.
        if (player.bleeding && now - (player.last_bleed || 0) >= BLEED_EVERY_MS) {
            player.last_bleed = now;
            player.hp -= BLEED_HP;
            if (this.hits.length < 40) {
                this.hits.push({ x: Math.round(player.x), y: Math.round(player.y), dir: null });
            }
            if (player.hp <= 0) {
                player.hp = 0;
                player.alive = false;
                player.bleeding = false;
                this.events.push(player.name + ' bled out on the street.');
                continue;
            }
        }
        if (!player.infected) { continue; }
        // The bite festers on a clock. Vision goes first (the client reads
        // the progress), then the fever starts taking flesh, then you turn.
        player.infection = Math.min(1, (now - player.infected_at) / INFECTION_FULL_MS);
        if (player.infection >= INFECTION_FEVER_FROM &&
            now - (player.last_fever || 0) >= INFECTION_FEVER_EVERY_MS) {
            player.last_fever = now;
            player.hp -= INFECTION_FEVER_HP;
            if (player.hp <= 0) {
                player.hp = 0;
                player.alive = false;
                this.events.push(player.name + ' burned out with fever.');
                continue;
            }
        }
        if (player.infection >= 1) {
            player.hp = 0;
            player.alive = false;
            this.events.push(player.name + ' turned. They are one of them now.');
            this.spawn_turned_zombie(player.x, player.y);
        }
    }
};

Game_Server.prototype.spawn_turned_zombie = function(x, y) {
    var id = 'z' + (this.next_id++);
    var stats = ZOMBIE_KINDS.runner;
    var max_hp = stats.hp_base + Math.max(0, this.wave - 1) * stats.hp_per_wave;
    this.zombies[id] = {
        id: id,
        kind: 'runner',
        x: clamp(x, 0, WORLD_WIDTH),
        y: clamp(y, 0, WORLD_HEIGHT),
        hp: max_hp,
        max_hp: max_hp,
        speed: stats.speed_min + Math.random() * (stats.speed_max - stats.speed_min),
        damage: stats.damage,
        attack_range: stats.attack_range,
        radius: stats.radius,
        last_attack: Date.now()
    };
};

Game_Server.prototype.nearest_standing_zone = function(x, y) {
    var best = null, best_d2 = Infinity;
    for (var i = 0; i < this.zones.length; i++) {
        var zone = this.zones[i];
        if (zone.overrun) { continue; }
        var dx = zone.x - x, dy = zone.y - y;
        var d2 = dx * dx + dy * dy;
        if (d2 < best_d2) { best_d2 = d2; best = zone; }
    }
    return best;
};

Game_Server.prototype.tick_zombies = function(dt, now) {
    for (var zid in this.zombies) {
        var zombie = this.zombies[zid];
        var target = null;
        var best = Infinity;
        for (var pid in this.players) {
            var player = this.players[pid];
            if (!player.alive) { continue; }
            var dx = player.x - zombie.x;
            var dy = player.y - zombie.y;
            var d2 = dx * dx + dy * dy;
            if (d2 < best) {
                best = d2;
                target = player;
            }
        }
        // Sappers go for the sandbags, not for you — unless a survivor is
        // close enough to be the easier meal.
        if (zombie.objective === 'zone' &&
            !(target && best <= ZONE_DEFEND_RADIUS * ZONE_DEFEND_RADIUS)) {
            var zone = this.nearest_standing_zone(zombie.x, zombie.y);
            if (zone) {
                var zdx = zone.x - zombie.x;
                var zdy = zone.y - zombie.y;
                var zdist = Math.sqrt(zdx * zdx + zdy * zdy) || 1;
                if (zdist > zone.r) {
                    var zpos = collide_circle_obstacles(
                        zombie.x + (zdx / zdist) * zombie.speed * dt,
                        zombie.y + (zdy / zdist) * zombie.speed * dt,
                        zombie.radius || 12);
                    zpos = this.collide_circle_barricades(zpos.x, zpos.y, zombie.radius || 12);
                    zombie.x = clamp(zpos.x, 0, WORLD_WIDTH);
                    zombie.y = clamp(zpos.y, 0, WORLD_HEIGHT);
                }
                else if (now - zombie.last_attack >= ZOMBIE_ATTACK_COOLDOWN_MS) {
                    zombie.last_attack = now;
                    zone.integrity = Math.max(0, zone.integrity - ZONE_BITE);
                    if (zone.integrity === 0 && !zone.overrun) {
                        zone.overrun = true;
                        this.events.push('Zone ' + zone.id + ' is overrun. The dead hold it now.');
                    }
                }
                continue;
            }
            // Both zones down: nothing left to sap, hunt like the rest.
            zombie.objective = 'player';
        }
        if (!target) { continue; }
        var dist = Math.sqrt(best) || 1;
        var range = zombie.attack_range || ZOMBIE_ATTACK_RANGE;
        var radius = zombie.radius || 12;
        if (dist > range) {
            // A barricade in its face gets torn at instead of walked through.
            var blocking = this.nearest_touching_barricade(zombie.x, zombie.y, radius + 8);
            if (blocking) {
                if (now - zombie.last_attack >= ZOMBIE_ATTACK_COOLDOWN_MS) {
                    zombie.last_attack = now;
                    this.damage_barricade(blocking, (zombie.damage || ZOMBIE_DAMAGE) * 2);
                }
            }
            else {
                // Move axis-separated against the obstacles so the horde slides
                // along walls and pours down the streets instead of sticking.
                var step_x = ((target.x - zombie.x) / dist) * zombie.speed * dt;
                var step_y = ((target.y - zombie.y) / dist) * zombie.speed * dt;
                var pos = collide_circle_obstacles(zombie.x + step_x, zombie.y, radius);
                pos = collide_circle_obstacles(pos.x, pos.y + step_y, radius);
                pos = this.collide_circle_barricades(pos.x, pos.y, radius);
                zombie.x = clamp(pos.x, 0, WORLD_WIDTH);
                zombie.y = clamp(pos.y, 0, WORLD_HEIGHT);
            }
        }
        else if (now - zombie.last_attack >= ZOMBIE_ATTACK_COOLDOWN_MS) {
            zombie.last_attack = now;
            target.hp -= (zombie.damage || ZOMBIE_DAMAGE);
            // Teeth tear: a bite can open a bleeder that keeps taking flesh
            // until it's bandaged. A wound is a state, not just lost HP.
            if (target.hp > 0 && !target.bleeding && Math.random() < BLEED_CHANCE) {
                target.bleeding = true;
                target.last_bleed = now;
            }
            // A bite can infect. No announcement — only the bitten player's
            // own client learns, and telling the team is up to them.
            if (target.alive && !target.infected && Math.random() < INFECTION_CHANCE) {
                target.infected = true;
                target.infection = 0;
                target.infected_at = now;
                target.last_fever = now;
            }
            if (target.hp <= 0) {
                target.hp = 0;
                target.alive = false;
                this.events.push(target.name + ' was overwhelmed by the horde.');
            }
        }
    }
    this.separate_zombies();
};

Game_Server.prototype.separate_zombies = function() {
    // Light body separation: the horde reads as a crowd of individuals,
    // not a stack of markers on one point.
    var list = [];
    for (var id in this.zombies) { list.push(this.zombies[id]); }
    for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
            var a = list[i], b = list[j];
            var dx = b.x - a.x;
            var dy = b.y - a.y;
            var min_dist = (a.radius || 12) + (b.radius || 12) - 2;
            var d2 = dx * dx + dy * dy;
            if (d2 >= min_dist * min_dist || d2 === 0) { continue; }
            var d = Math.sqrt(d2);
            var push = (min_dist - d) / 2;
            var ux = dx / d, uy = dy / d;
            a.x = clamp(a.x - ux * push, 0, WORLD_WIDTH);
            a.y = clamp(a.y - uy * push, 0, WORLD_HEIGHT);
            b.x = clamp(b.x + ux * push, 0, WORLD_WIDTH);
            b.y = clamp(b.y + uy * push, 0, WORLD_HEIGHT);
        }
    }
};

Game_Server.prototype.tick_projectiles = function(dt, now) {
    for (var id in this.projectiles) {
        var projectile = this.projectiles[id];
        if (now >= projectile.expires) {
            delete this.projectiles[id];
            continue;
        }
        // A tick moves an arrow ~30px — enough to tunnel straight through a
        // crawler or a barricade. Integrate in sub-steps small enough that
        // nothing fits between two consecutive positions.
        var step_count = Math.max(1, Math.ceil((PROJECTILE_SPEED * dt) / 12));
        var removed = false;
        for (var s = 0; s < step_count && !removed; s++) {
            projectile.x += projectile.vx * (dt / step_count);
            projectile.y += projectile.vy * (dt / step_count);
            if (projectile.x < 0 || projectile.x > WORLD_WIDTH ||
                projectile.y < 0 || projectile.y > WORLD_HEIGHT ||
                point_blocked(projectile.x, projectile.y)) {
                // Walls and wrecks stop arrows dead.
                removed = true;
                break;
            }
            for (var zid in this.zombies) {
                var zombie = this.zombies[zid];
                var dx = zombie.x - projectile.x;
                var dy = zombie.y - projectile.y;
                if (dx * dx + dy * dy <= PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS) {
                    var owner = this.players[projectile.owner] || { name: 'Someone' };
                    this.damage_zombie(zombie, PROJECTILE_DAMAGE, owner, projectile.rotation);
                    removed = true;
                    break;
                }
            }
        }
        if (removed) {
            delete this.projectiles[id];
        }
    }
};

Game_Server.prototype.tick_pickups = function() {
    var now = Date.now();
    for (var id in this.pickups) {
        var pickup = this.pickups[id];
        if (pickup.expires && now >= pickup.expires) {
            delete this.pickups[id];
            continue;
        }
        for (var pid in this.players) {
            var player = this.players[pid];
            if (!player.alive) { continue; }
            var dx = player.x - pickup.x;
            var dy = player.y - pickup.y;
            if (dx * dx + dy * dy <= 30 * 30) {
                if (pickup.kind === 'ammo') {
                    player.ammo += 10;
                    this.events.push(player.name + ' scavenged arrows.');
                }
                else {
                    // A first aid kit: real healing, and it closes a bleeder.
                    player.hp = Math.min(PLAYER_MAX_HP, player.hp + 25);
                    player.bleeding = false;
                    this.events.push(player.name + ' patched up with a first aid kit.');
                }
                delete this.pickups[id];
                break;
            }
        }
    }
};

Game_Server.prototype.build_snapshot = function() {
    var players = [];
    for (var pid in this.players) {
        var p = this.players[pid];
        players.push({
            id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y),
            rotation: p.rotation, hp: p.hp, ammo: p.ammo, alive: p.alive,
            stamina: Math.round(p.stamina || 0), boards: p.boards || 0,
            infected: !!p.infected,
            infection: p.infected ? Math.round((p.infection || 0) * 100) / 100 : 0,
            bleeding: !!p.bleeding,
            bandages: p.bandages || 0
        });
    }
    var zombies = [];
    for (var zid in this.zombies) {
        var z = this.zombies[zid];
        zombies.push({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, max_hp: z.max_hp, kind: z.kind || 'walker' });
    }
    var projectiles = [];
    for (var aid in this.projectiles) {
        var a = this.projectiles[aid];
        projectiles.push({ id: a.id, x: Math.round(a.x), y: Math.round(a.y), rotation: a.rotation });
    }
    var pickups = [];
    for (var kid in this.pickups) {
        var k = this.pickups[kid];
        pickups.push({ id: k.id, x: k.x, y: k.y, kind: k.kind });
    }
    var barricades = [];
    for (var bid in this.barricades) {
        var b = this.barricades[bid];
        barricades.push({
            id: b.id, x: Math.round(b.x), y: Math.round(b.y),
            rotation: b.rotation, hp: b.hp, max_hp: b.max_hp
        });
    }
    var supply_drop = null;
    if (this.supply_drop) {
        supply_drop = {
            x: this.supply_drop.x,
            y: this.supply_drop.y,
            state: this.supply_drop.state,
            lands_in: this.supply_drop.state === 'incoming' ?
                Math.max(0, this.supply_drop.lands_at - Date.now()) : 0
        };
    }
    var snapshot = {
        type: 'snapshot',
        players: players,
        zombies: zombies,
        projectiles: projectiles,
        pickups: pickups,
        barricades: barricades,
        supply_drop: supply_drop,
        wave: {
            number: this.wave,
            remaining: zombies.length + this.zombies_to_spawn,
            intermission: this.intermission_until ? Math.max(0, this.intermission_until - Date.now()) : 0,
            tokens: this.respawn_tokens,
            kills: this.kills
        },
        zones: this.zones.map(function(zone) {
            return { id: zone.id, x: zone.x, y: zone.y, r: zone.r,
                     integrity: Math.round(zone.integrity) };
        }),
        events: this.events.splice(0, this.events.length),
        deaths: this.deaths.splice(0, this.deaths.length),
        hits: this.hits.splice(0, this.hits.length),
        shots: this.shots.splice(0, this.shots.length),
        shoves: this.shoves.splice(0, this.shoves.length)
    };
    return snapshot;
};

Game_Server.prototype.broadcast_snapshot = function() {
    if (Object.keys(this.sockets).length === 0) {
        this.events.length = 0;
        this.deaths.length = 0;
        this.hits.length = 0;
        this.shots.length = 0;
        this.shoves.length = 0;
        return;
    }
    var payload = JSON.stringify(this.build_snapshot());
    for (var id in this.sockets) {
        var ws = this.sockets[id];
        if (ws.readyState === 1) {
            ws.send(payload, function() { /* ignore send errors */ });
        }
    }
};

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

module.exports = Game_Server;
