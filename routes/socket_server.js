var express = require('express');
var router = express.Router();

/* GET the right socket server to connect to game.
 * The WebSocket server shares the HTTP server, so the socket port is
 * whatever port the page itself was served from. */
router.get('/', function(req, res, next) {
  var port = process.env.PORT || process.env.GAME_CLIENT_SOCKET_PORT || 3000;
  res.json({ socket_port: port });
});

module.exports = router;
