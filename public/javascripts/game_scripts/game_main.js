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
        this.game.stage.backgroundColor = '#1a1d1a';
        this.create_textures();
        this.main_player = new Main_Player(this.game, this.client);
        this.game.camera.follow(this.main_player.sprite);
        this.create_hud();
        this.created = true;
    },
    create_textures: function() {
        // Everything but the bow/arrow art is generated at runtime.
        var zombie_graphic = this.game.add.graphics(0, 0);
        zombie_graphic.beginFill(0x4a7a3a);
        zombie_graphic.drawCircle(16, 16, 26);
        zombie_graphic.beginFill(0x2d4d24);
        zombie_graphic.drawCircle(16, 16, 12);
        zombie_graphic.endFill();
        this.zombie_texture = zombie_graphic.generateTexture();
        zombie_graphic.destroy();

        var ammo_graphic = this.game.add.graphics(0, 0);
        ammo_graphic.beginFill(0xc9a227);
        ammo_graphic.drawRect(0, 0, 18, 18);
        ammo_graphic.endFill();
        this.ammo_texture = ammo_graphic.generateTexture();
        ammo_graphic.destroy();

        var health_graphic = this.game.add.graphics(0, 0);
        health_graphic.beginFill(0xbb3333);
        health_graphic.drawRect(0, 7, 18, 4);
        health_graphic.drawRect(7, 0, 4, 18);
        health_graphic.endFill();
        this.health_texture = health_graphic.generateTexture();
        health_graphic.destroy();
    },
    create_hud: function() {
        var style = { font: "14px Arial", fill: "#ffffff", stroke: '#000000', strokeThickness: 3 };
        this.hud_status = this.game.add.text(10, 10, '', style);
        this.hud_status.fixedToCamera = true;
        this.hud_wave = this.game.add.text(this.game.camera.width / 2, 10, '', {
            font: "18px Arial", fill: "#ff6666", stroke: '#000000', strokeThickness: 3
        });
        this.hud_wave.anchor.setTo(0.5, 0);
        this.hud_wave.fixedToCamera = true;
        this.hud_dead = this.game.add.text(this.game.camera.width / 2, this.game.camera.height / 2, '', {
            font: "26px Arial", fill: "#ff3333", stroke: '#000000', strokeThickness: 4
        });
        this.hud_dead.anchor.setTo(0.5, 0.5);
        this.hud_dead.fixedToCamera = true;
    },
    update: function() {
        if (this.pending_snapshot) {
            this.render_snapshot(this.pending_snapshot);
            this.pending_snapshot = null;
        }
        this.main_player.update();
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
                sprite.tint = 0x66aaff;
                var label = self.game.add.text(player.x, player.y - 26, player.name, {
                    font: "11px Arial", fill: "#aaccff", stroke: '#000000', strokeThickness: 2
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
            if (!sprite) {
                sprite = self.zombie_sprites[zombie.id] = self.game.add.sprite(zombie.x, zombie.y, self.zombie_texture);
                sprite.anchor.set(0.5);
            }
            sprite.x = zombie.x;
            sprite.y = zombie.y;
            // Bloodied zombies darken toward red.
            var health_ratio = Math.max(0, zombie.hp / zombie.max_hp);
            sprite.tint = health_ratio > 0.66 ? 0xffffff : (health_ratio > 0.33 ? 0xddaa88 : 0xcc6655);
        });
        prune(this.zombie_sprites, seen, function(sprite) { sprite.destroy(); });

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
            this.hud_status.setText('HP: ' + own.hp + '   Arrows: ' + own.ammo +
                (own.ammo === 0 ? '  (melee with F)' : ''));
            this.hud_dead.setText(own.alive ? '' : 'You went down.\nThe group can revive you next wave.');
        }

        if (snapshot.wave.intermission > 0) {
            this.hud_wave.setText('Next wave in ' + Math.ceil(snapshot.wave.intermission / 1000) + '...');
        }
        else if (snapshot.wave.number > 0) {
            this.hud_wave.setText('Wave ' + snapshot.wave.number + '  —  ' + snapshot.wave.remaining + ' left');
        }

        snapshot.events.forEach(function(event_text) {
            self.display_new_message(event_text);
        });
    },
    show_disconnected: function() {
        if (this.hud_dead) {
            this.hud_dead.setText('Connection lost.');
        }
    },
    display_new_message: function(text) {
        if (this.displayed_messages.length >= 5) {
            var oldest = this.displayed_messages.shift();
            oldest.destroy();
        }
        this.displayed_messages.forEach(function(message) {
            message.cameraOffset.y -= 18;
        });
        var new_message = this.game.add.text(10, this.game.camera.height - 30, text, {
            font: "12px Arial", fill: "#ffffff", stroke: '#000000', strokeThickness: 3
        });
        new_message.fixedToCamera = true;
        this.displayed_messages.push(new_message);
    }
};

function prune(map, seen, destroy) {
    for (var id in map) {
        if (!seen[id]) {
            destroy(map[id]);
            delete map[id];
        }
    }
}
