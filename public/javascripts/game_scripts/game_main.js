require('./main_player.js');

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
