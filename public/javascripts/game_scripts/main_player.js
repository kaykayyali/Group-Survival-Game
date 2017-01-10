Main_Player = function () {
    Fast_Bindall(this);
    console.log("CREATED A NEW PLAYER");
    //  Creates 30 bullets, using the 'bullet' graphic

    this.weapon = Game.add.weapon(1, 'arrow');

    //  The bullet will be automatically killed when it leaves the world bounds

    this.weapon.bulletKillType = Phaser.Weapon.KILL_WORLD_BOUNDS;

    //  The speed at which the bullet is fired

    this.weapon.bulletSpeed = 600;

    //  Speed-up the rate of fire, allowing them to shoot 1 bullet every 60ms

    this.weapon.fireRate = 100;

    this.sprite = Game.add.sprite(50, 400, 'bow');

    this.sprite.anchor.set(0.5);

    Game.physics.arcade.enable(this.sprite);

    this.sprite.body.drag.set(70);

    this.sprite.body.maxVelocity.set(200);

    //  Tell the this.Weapon to track the 'player' Sprite

    //  With no offsets from the position

    //  But the 'true' argument tells the this.weapon to track this.sprite rotation

    this.weapon.trackSprite(this.sprite, 0, 0, true);

    this.cursors = Game.input.keyboard.createCursorKeys();

    this.fireButton = Game.input.keyboard.addKey(Phaser.KeyCode.SPACEBAR);
};

Main_Player.prototype.update = function() {
    if (this.cursors.up.isDown)
    {
        Game.physics.arcade.accelerationFromRotation(this.sprite.rotation, 300, this.sprite.body.acceleration);
    }
    else
    {
        this.sprite.body.acceleration.set(0);
    }

    if (this.cursors.left.isDown)
    {
        this.sprite.body.angularVelocity = -300;
    }
    else if (this.cursors.right.isDown)
    {
        this.sprite.body.angularVelocity = 300;
    }
    else
    {
        this.sprite.body.angularVelocity = 0;
    }

    if (this.fireButton.isDown)
    {
        this.weapon.fire();
    }

    Game.world.wrap(this.sprite, 16);
};

module.exports = Main_Player;