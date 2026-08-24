var server = require('http').createServer();
var express = require('express');
var WebSocketServer = require('ws').Server;
var path = require('path');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');

var index = require('./routes/index');
var game = require('./routes/game');
var socket_server = require('./routes/socket_server');
var Game_Server = require('./game_server/game_server');

var app = express();
var wss = new WebSocketServer({ server: server });
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));


app.get('/favicon.ico', function(req, res) { res.status(204).end(); });

app.use('/', index);
app.use('/game', game);
app.use('/socket_server', socket_server);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

var game_server = new Game_Server();
game_server.start();

wss.on('connection', function (ws) {
  game_server.handle_connection(ws);
});

var port = process.env.PORT || process.env.GAME_CLIENT_SOCKET_PORT || 3000;
server.on('request', app);
server.listen(port, function () { console.log('Group Survival listening on ' + server.address().port) });

module.exports = app;
