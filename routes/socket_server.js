var express = require('express');
var router = express.Router();

/* GET the right socket server to connect to game. */
router.get('/', function(req, res, next) {
  res.json({ socket_port: process.env.GAME_CLIENT_SOCKET_PORT });
});

module.exports = router;
