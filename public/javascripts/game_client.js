var Game_Client = function(options) {
	Fast_Bindall(this);
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
		return;
	});
};

Game_Client.prototype.connect_to_socket_server = function(callback) {
	var host = window.document.location.host.replace(/:.*/, '');
	if (!this.socket_port) {
		callback("Failed to find Socket Port");
		return;
	}
	this.socket_connection =  new WebSocket('ws://' + host + ':' +this.socket_port);
	this.socket_connection.onopen = function (event) {
		console.log(event);
		console.log("Web Socket Connection Established.");
		callback();
		return;
	};
	this.socket_connection.onmessage = function (event) {
		console.log(event);
		return;
	};
	this.socket_connection.onclose = function(event) {
		alert("Web Socket Connection Dropped.");
	}
};