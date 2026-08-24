var Game_Client = function(options) {
	Fast_Bindall(this);
	this.player_id = null;
	this.world = { width: 1600, height: 1200 };
	this.latest_snapshot = null;
};


Game_Client.prototype.init = function() {
	var self = this;
	console.log("Loading...");
	async.series([
		self.fetch_socket_url,
		self.connect_to_socket_server
	], function(error) {
		if (error) {
			alert(error);
		}
		else {
			Game = new Phaser.Game(800, 600, Phaser.CANVAS, 'game-target');
			Group_Survive = new Group_Survive_State(Game, self);
			Game.state.add('Game', Group_Survive, true);
			self.game = Game;
		}
	});
};

Game_Client.prototype.fetch_socket_url = function(callback) {
	var self = this;
	$.get('/socket_server', function(data) {
		self.socket_port = data.socket_port;
		callback();
	})
	.fail(function() {
		callback("Failed to retrieve Socket Port");
	});
};

Game_Client.prototype.connect_to_socket_server = function(callback) {
	var self = this;
	var host = window.document.location.host.replace(/:.*/, '');
	var port = window.document.location.port || this.socket_port;
	if (!port) {
		callback("Failed to find Socket Port");
		return;
	}
	var protocol = window.document.location.protocol === 'https:' ? 'wss://' : 'ws://';
	this.socket_connection = new WebSocket(protocol + host + ':' + port);
	this.socket_connection.onopen = function (event) {
		console.log("Web Socket Connection Established.");
		self.send({ type: 'join', name: Cookies.get('user-name') || 'Survivor' });
		callback();
	};
	this.socket_connection.onmessage = function (event) {
		var message;
		try {
			message = JSON.parse(event.data);
		} catch (e) {
			return;
		}
		self.handle_message(message);
	};
	this.socket_connection.onclose = function(event) {
		if (Group_Survive && Group_Survive.show_disconnected) {
			Group_Survive.show_disconnected();
		}
	};
};

Game_Client.prototype.handle_message = function(message) {
	if (message.type === 'welcome') {
		this.player_id = message.id;
		this.world = message.world;
	}
	else if (message.type === 'snapshot') {
		this.latest_snapshot = message;
		if (Group_Survive && Group_Survive.apply_snapshot) {
			Group_Survive.apply_snapshot(message);
		}
	}
};

Game_Client.prototype.send = function(message) {
	if (this.socket_connection && this.socket_connection.readyState === 1) {
		this.socket_connection.send(JSON.stringify(message));
	}
};
