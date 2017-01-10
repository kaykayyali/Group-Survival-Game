/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	__webpack_require__(1);

	Group_Survive = function(game) {
	    Fast_Bindall(this);
	    this.game = game;
	};

	Group_Survive.prototype = {
	    preload: function() {
	     this.game.load.image('arrow', 'assets/sprites/arrow.png');
	     this.game.load.image('bow', 'assets/sprites/bow.png');
	    }, 
	    create: function() {
	        console.log("LOADING");
	        this.main_player = new Main_Player();
	    },
	    update: function() {
	        this.main_player.update();
	    },
	    render: function() {
	    },
	    display_new_message: function(new_message) {
	        if (!this.displayed_messages) {
	            this.displayed_messages = [];
	        }
	        else {
	            console.log(this.displayed_messages)
	            if (this.displayed_messages.length >= 3 ) {
	                this.displayed_messages[0].destroy();
	                this.displayed_messages.pop();
	            }
	        }
	        var camera_width = this.game.camera.width / 4;
	        var camera_height = ((this.game.camera.height / 4) - 100 );
	        var camera_height_multiplier = 20; // pixels
	        camera_height = camera_height + (camera_height_multiplier * this.displayed_messages.length);
	        var new_message = this.game.add.text(camera_width, camera_height, new_message.data, {font: "12px Arial", fill: "#ffffff", stroke: '#000000', strokeThickness: 3});
	        new_message.anchor.setTo(0.5, 0.5);
	        new_message.fixedToCamera = true;
	        this.displayed_messages.push(new_message);
	    }
	};


/***/ },
/* 1 */
/***/ function(module, exports) {

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

/***/ }
/******/ ]);