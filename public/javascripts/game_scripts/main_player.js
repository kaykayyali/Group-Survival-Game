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
};

Main_Player.prototype.update = function() {
    if (!this.alive) {
        return;
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
