/*
 * Local player: WASD / arrow-key movement, aim with the mouse, left click
 * or spacebar to shoot, F to melee shove. Movement is client-side and
 * reported to the server; health/ammo/alive come back from the server.
 */
Main_Player = function (game, client) {
    Fast_Bindall(this);
    this.game = game;
    this.client = client;
    this.alive = true;
    this.last_shot = 0;
    this.last_melee_sent = 0;
    this.last_sent = 0;

    this.sprite = game.add.sprite(client.world.width / 2, client.world.height / 2, 'bow');
    this.sprite.anchor.set(0.5);

    game.physics.arcade.enable(this.sprite);
    this.sprite.body.collideWorldBounds = true;
    this.sprite.body.maxVelocity.set(220);

    this.cursors = game.input.keyboard.createCursorKeys();
    this.keys = game.input.keyboard.addKeys({
        up: Phaser.KeyCode.W,
        down: Phaser.KeyCode.S,
        left: Phaser.KeyCode.A,
        right: Phaser.KeyCode.D,
        fire: Phaser.KeyCode.SPACEBAR,
        melee: Phaser.KeyCode.F
    });
    game.input.keyboard.addKeyCapture([
        Phaser.KeyCode.W, Phaser.KeyCode.S, Phaser.KeyCode.A, Phaser.KeyCode.D,
        Phaser.KeyCode.SPACEBAR, Phaser.KeyCode.F,
        Phaser.KeyCode.UP, Phaser.KeyCode.DOWN, Phaser.KeyCode.LEFT, Phaser.KeyCode.RIGHT
    ]);
};

Main_Player.prototype.apply_server_state = function(state) {
    this.alive = state.alive;
    this.sprite.visible = state.alive;
    if (!state.alive) {
        this.sprite.body.velocity.set(0);
    }
    // Reconcile with the authority: when the server's position disagrees
    // beyond jitter (it rate-limits and collides movement), pull the local
    // sprite toward it instead of letting the two realities drift apart.
    var dx = state.x - this.sprite.x;
    var dy = state.y - this.sprite.y;
    var d2 = dx * dx + dy * dy;
    if (d2 > 120 * 120) {
        this.sprite.x = state.x;
        this.sprite.y = state.y;
    }
    else if (d2 > 40 * 40) {
        this.sprite.x += dx * 0.25;
        this.sprite.y += dy * 0.25;
    }
};

Main_Player.prototype.update = function() {
    if (!this.alive) {
        return;
    }
    // Mirror the server's obstacle collision so prediction matches
    // authority: physics has already integrated this frame's motion,
    // push the sprite back out of any building or wreck.
    var map = this.client.map;
    if (map && map.obstacles) {
        var resolved = resolve_map_circle(map.obstacles, this.sprite.x, this.sprite.y, 14);
        this.sprite.x = resolved.x;
        this.sprite.y = resolved.y;
    }
    var speed = 220;
    var vx = 0;
    var vy = 0;
    if (this.cursors.up.isDown || this.keys.up.isDown) { vy = -speed; }
    if (this.cursors.down.isDown || this.keys.down.isDown) { vy = speed; }
    if (this.cursors.left.isDown || this.keys.left.isDown) { vx = -speed; }
    if (this.cursors.right.isDown || this.keys.right.isDown) { vx = speed; }
    this.sprite.body.velocity.set(vx, vy);

    // Aim at the mouse pointer.
    var pointer = this.game.input.activePointer;
    this.sprite.rotation = Math.atan2(
        pointer.worldY - this.sprite.y,
        pointer.worldX - this.sprite.x
    );

    var now = this.game.time.now;
    if ((this.keys.fire.isDown || pointer.leftButton.isDown) && now - this.last_shot > 250) {
        this.last_shot = now;
        this.client.send({ type: 'shoot' });
        // Immediate local feedback (release flash, camera kick); the state
        // gates it on actually having an arrow to loose.
        if (window.Group_Survive && Group_Survive.on_local_fire) {
            Group_Survive.on_local_fire(this.sprite.x, this.sprite.y, this.sprite.rotation);
        }
    }
    if (this.keys.melee.isDown && now - this.last_melee_sent > 400) {
        this.last_melee_sent = now;
        this.client.send({ type: 'melee' });
    }

    // Report position ~20 times a second.
    if (now - this.last_sent > 50) {
        this.last_sent = now;
        this.client.send({
            type: 'move',
            x: this.sprite.x,
            y: this.sprite.y,
            rotation: this.sprite.rotation
        });
    }
};

// Same shape as the server's collide_circle_obstacles: push a circle out
// of every solid rect, sliding along faces.
function resolve_map_circle(obstacles, x, y, radius) {
    for (var i = 0; i < obstacles.length; i++) {
        var o = obstacles[i];
        var nearest_x = Math.max(o.x, Math.min(x, o.x + o.w));
        var nearest_y = Math.max(o.y, Math.min(y, o.y + o.h));
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
