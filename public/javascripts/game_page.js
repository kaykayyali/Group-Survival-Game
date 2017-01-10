var game_options = {

};
var Game_Assets = {};
var Client_Data = {
	messages: []
};
var Group_Survive;
var Main_player;
var Game;
$(document).ready(function() {
	var Client = new Game_Client(game_options);
	Client.init();
});


