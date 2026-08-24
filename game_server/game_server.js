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

var WAVE_INTERMISSION_MS = 6000;

function Game_Server() {
    this.players = {}; // id -> player
    this.zombies = {}; // id -> zombie
    this.projectiles = {};
    this.pickups = {};
    this.next_id = 1;
    this.wave = 0;
    this.zombies_to_spawn = 0;
    this.intermission_until = Date.now() + WAVE_INTERMISSION_MS;
    this.spawn_accumulator = 0;
    this.events = [];
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
            this.spawn_player(id, message.name);
            break;
        case 'move':
            if (player && player.alive) {
                var now = Date.now();
                var dt = Math.min(0.5, (now - (player.last_move_time || now)) / 1000);
                player.last_move_time = now;
                // Movement stays server-validated: cap displacement to what the
                // player speed allows for the elapsed time (with a little slack
                // for network jitter).
                var max_step = Math.max(20, PLAYER_SPEED * dt * 1.5);
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
                player.x = target_x;
                player.y = target_y;
                player.rotation = Number(message.rotation) || 0;
            }
            break;
        case 'shoot':
            if (player && player.alive) {
                this.player_shoot(player);
            }
            break;
        case 'melee':
            if (player && player.alive) {
                this.player_melee(player);
            }
            break;
    }
};

Game_Server.prototype.spawn_player = function(id, name) {
    name = String(name || 'Survivor').slice(0, 20);
    this.players[id] = {
        id: id,
        name: name,
        x: WORLD_WIDTH / 2 + (Math.random() * 120 - 60),
        y: WORLD_HEIGHT / 2 + (Math.random() * 120 - 60),
        rotation: 0,
        hp: PLAYER_MAX_HP,
        ammo: PLAYER_START_AMMO,
        alive: true,
        last_melee: 0
    };
    this.events.push(name + ' joined the group. Survive together.');
    var ws = this.sockets[id];
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'welcome',
            id: id,
            world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }
        }));
    }
};

Game_Server.prototype.player_shoot = function(player) {
    if (player.ammo <= 0) {
        return;
    }
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
};

Game_Server.prototype.player_melee = function(player) {
    var now = Date.now();
    if (now - player.last_melee < MELEE_COOLDOWN_MS) {
        return;
    }
    player.last_melee = now;
    for (var zid in this.zombies) {
        var zombie = this.zombies[zid];
        var dx = zombie.x - player.x;
        var dy = zombie.y - player.y;
        if (dx * dx + dy * dy <= MELEE_RANGE * MELEE_RANGE) {
            var dist = Math.sqrt(dx * dx + dy * dy) || 1;
            zombie.x = clamp(zombie.x + (dx / dist) * MELEE_KNOCKBACK, 0, WORLD_WIDTH);
            zombie.y = clamp(zombie.y + (dy / dist) * MELEE_KNOCKBACK, 0, WORLD_HEIGHT);
            this.damage_zombie(zombie, MELEE_DAMAGE, player);
        }
    }
};

Game_Server.prototype.damage_zombie = function(zombie, amount, player) {
    zombie.hp -= amount;
    if (zombie.hp <= 0) {
        delete this.zombies[zombie.id];
        this.events.push(player.name + ' put one down.');
        if (Math.random() < 0.25) {
            this.spawn_pickup(zombie.x, zombie.y);
        }
    }
};

Game_Server.prototype.spawn_pickup = function(x, y) {
    var id = 'k' + (this.next_id++);
    this.pickups[id] = {
        id: id,
        x: clamp(x, 40, WORLD_WIDTH - 40),
        y: clamp(y, 40, WORLD_HEIGHT - 40),
        kind: Math.random() < 0.6 ? 'ammo' : 'health'
    };
};

Game_Server.prototype.start_wave = function() {
    this.wave += 1;
    this.zombies_to_spawn = 4 + this.wave * 3;
    this.events.push('Wave ' + this.wave + ' — they are coming...');
    // Fallen survivors get back up between waves.
    for (var id in this.players) {
        var player = this.players[id];
        if (!player.alive) {
            player.alive = true;
            player.hp = Math.floor(PLAYER_MAX_HP / 2);
            player.ammo = Math.max(player.ammo, 8);
            player.x = WORLD_WIDTH / 2;
            player.y = WORLD_HEIGHT / 2;
        }
    }
    this.spawn_pickup(Math.random() * WORLD_WIDTH, Math.random() * WORLD_HEIGHT);
    this.spawn_pickup(Math.random() * WORLD_WIDTH, Math.random() * WORLD_HEIGHT);
};

Game_Server.prototype.spawn_zombie = function() {
    var id = 'z' + (this.next_id++);
    // Spawn on a random edge of the world so the horde closes in.
    var edge = Math.floor(Math.random() * 4);
    var x = Math.random() * WORLD_WIDTH;
    var y = Math.random() * WORLD_HEIGHT;
    if (edge === 0) { y = 0; }
    if (edge === 1) { y = WORLD_HEIGHT; }
    if (edge === 2) { x = 0; }
    if (edge === 3) { x = WORLD_WIDTH; }
    var max_hp = ZOMBIE_BASE_HP + (this.wave - 1) * 10;
    this.zombies[id] = {
        id: id,
        x: x,
        y: y,
        hp: max_hp,
        max_hp: max_hp,
        speed: ZOMBIE_SPEED_MIN + Math.random() * (ZOMBIE_SPEED_MAX - ZOMBIE_SPEED_MIN),
        last_attack: 0
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
            this.events.push('The whole group went down. The horde moves on... try that wave again.');
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
            this.spawn_accumulator += dt;
            // Trickle the horde in rather than dumping it at once.
            if (this.spawn_accumulator >= 0.7) {
                this.spawn_accumulator = 0;
                this.spawn_zombie();
                this.zombies_to_spawn -= 1;
            }
        }
    }

    this.tick_zombies(dt, now);
    this.tick_projectiles(dt, now);
    this.tick_pickups();
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
        if (!target) { continue; }
        var dist = Math.sqrt(best) || 1;
        if (dist > ZOMBIE_ATTACK_RANGE) {
            zombie.x += ((target.x - zombie.x) / dist) * zombie.speed * dt;
            zombie.y += ((target.y - zombie.y) / dist) * zombie.speed * dt;
        }
        else if (now - zombie.last_attack >= ZOMBIE_ATTACK_COOLDOWN_MS) {
            zombie.last_attack = now;
            target.hp -= ZOMBIE_DAMAGE;
            if (target.hp <= 0) {
                target.hp = 0;
                target.alive = false;
                this.events.push(target.name + ' was overwhelmed by the horde.');
            }
        }
    }
};

Game_Server.prototype.tick_projectiles = function(dt, now) {
    for (var id in this.projectiles) {
        var projectile = this.projectiles[id];
        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;
        if (now >= projectile.expires ||
            projectile.x < 0 || projectile.x > WORLD_WIDTH ||
            projectile.y < 0 || projectile.y > WORLD_HEIGHT) {
            delete this.projectiles[id];
            continue;
        }
        for (var zid in this.zombies) {
            var zombie = this.zombies[zid];
            var dx = zombie.x - projectile.x;
            var dy = zombie.y - projectile.y;
            if (dx * dx + dy * dy <= PROJECTILE_HIT_RADIUS * PROJECTILE_HIT_RADIUS) {
                var owner = this.players[projectile.owner] || { name: 'Someone' };
                this.damage_zombie(zombie, PROJECTILE_DAMAGE, owner);
                delete this.projectiles[id];
                break;
            }
        }
    }
};

Game_Server.prototype.tick_pickups = function() {
    for (var id in this.pickups) {
        var pickup = this.pickups[id];
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
                    player.hp = Math.min(PLAYER_MAX_HP, player.hp + 25);
                    this.events.push(player.name + ' patched up.');
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
            rotation: p.rotation, hp: p.hp, ammo: p.ammo, alive: p.alive
        });
    }
    var zombies = [];
    for (var zid in this.zombies) {
        var z = this.zombies[zid];
        zombies.push({ id: z.id, x: Math.round(z.x), y: Math.round(z.y), hp: z.hp, max_hp: z.max_hp });
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
    var snapshot = {
        type: 'snapshot',
        players: players,
        zombies: zombies,
        projectiles: projectiles,
        pickups: pickups,
        wave: {
            number: this.wave,
            remaining: zombies.length + this.zombies_to_spawn,
            intermission: this.intermission_until ? Math.max(0, this.intermission_until - Date.now()) : 0
        },
        events: this.events.splice(0, this.events.length)
    };
    return snapshot;
};

Game_Server.prototype.broadcast_snapshot = function() {
    if (Object.keys(this.sockets).length === 0) {
        this.events.length = 0;
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
