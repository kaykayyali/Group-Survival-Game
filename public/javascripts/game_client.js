var Game_Client = function(options) {
	Fast_Bindall(this);
	this.player_id = null;
	this.world = { width: 1600, height: 1200 };
	this.map = null;
	this.latest_snapshot = null;
};


Game_Client.prototype.init = function() {
	var self = this;
	console.log("Loading...");
	async.series([
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

Game_Client.prototype.connect_to_socket_server = function(callback) {
	var self = this;
	// The WebSocket server shares the HTTP server, so connect straight to
	// the page's own origin (host already includes the port when non-default,
	// and works unchanged behind a reverse proxy).
	var protocol = window.document.location.protocol === 'https:' ? 'wss://' : 'ws://';
	var url = protocol + window.document.location.host;
	// The very first connect right after a server restart can lose the race
	// with the HTTP/WS server binding its port (surfaces as a browser
	// "WebSocket connection failed" and, previously, a hung load). Retry the
	// initial connect up to 3 times with a short backoff before giving up.
	// Once a connection is actually established, the retry logic is disarmed
	// and onclose reverts to the original show_disconnected behavior.
	var INITIAL_RETRIES = 3;
	var RETRY_DELAY_MS = 700;
	var retries_left = INITIAL_RETRIES;

	function attempt() {
		var established = false;
		var socket = new WebSocket(url);
		self.socket_connection = socket;

		socket.onopen = function (event) {
			established = true;
			console.log("Web Socket Connection Established.");
			self.send({ type: 'join', name: Cookies.get('user-name') || 'Survivor' });
			callback();
		};
		socket.onmessage = function (event) {
			var message;
			try {
				message = JSON.parse(event.data);
			} catch (e) {
				return;
			}
			self.handle_message(message);
		};
		socket.onerror = function (event) {
			// Errors are handled via onclose (which always follows), so the
			// retry decision lives in one place and never fires twice.
		};
		socket.onclose = function(event) {
			if (established) {
				// An already-established connection dropped: keep the original
				// behavior for a mid-game disconnect.
				if (Group_Survive && Group_Survive.show_disconnected) {
					Group_Survive.show_disconnected();
				}
				return;
			}
			// The initial connect never opened. Retry a few times before
			// declaring failure back to the async.series callback.
			if (retries_left > 0) {
				retries_left -= 1;
				console.log("Web Socket connect failed, retrying (" +
					(INITIAL_RETRIES - retries_left) + "/" + INITIAL_RETRIES + ")...");
				setTimeout(attempt, RETRY_DELAY_MS);
			}
			else {
				callback('Unable to reach the game server. Please refresh to try again.');
			}
		};
	}

	attempt();
};

Game_Client.prototype.handle_message = function(message) {
	if (message.type === 'welcome') {
		this.player_id = message.id;
		this.world = message.world;
		this.map = message.map || null;
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
