var http = require('http')
  , connect = require('connect')
  , path = require('path')
  , levelup = require('levelup')
  , bytewise = require('byteup')()
  , firedup = require('./lib/firedup')
  , firedupServer = require('./lib/firedupserver')
  , io = require('socket.io')
  , getUrlTail = require('./lib/urltail.js');

var dbPath = path.join(__dirname, 'data', 'test');
var db = firedup(levelup(dbPath));
var dbPrefix = '/db';

var app = connect()
  .use(connect.logger('dev'))
  .use(connect.query())
  .use(firedupServer(db, dbPrefix))
  .use(connect.static(__dirname + '/public'));

var port = parseInt(process.argv[2]) || 3000;
var server = http.createServer(app).listen(port);
var sockets = io.listen(server, { log: false });
sockets.sockets.on('connection', function (socket) {
  socket.on('listen', function (url) {
    var dbUrl = getUrlTail(dbPrefix, url);
    db.urlWatch(dbUrl)
      .on('value', function (data) {
        socket.emit('value', data);
      });
  });
});
console.log('Listening on port ' + port);
