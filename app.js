var http = require('http')
  , connect = require('connect')
  , urlrouter = require('urlrouter')
  , rimraf = require('rimraf')
  , path = require('path')
  , levelup = require('levelup')
  , bytewise = require('byteup')()
  , sublevel = require('level-sublevel')
  , livestream = require('level-live-stream')
  , firedup = require('./lib/firedup');

var db;
var dbPath = path.join(__dirname, 'data', 'test');

function initDb(cb) {
  rimraf.sync(dbPath)
  db = levelup(dbPath, { keyEncoding: 'bytewise', valueEncoding: 'json' },
    function (err) {
      db = firedup(db);
      db = sublevel(db);
      insertData();
    });

  function insertData() {
    var url = 'users/eugene';
    var data = {
      name: 'Eugene',
      number: 42,
      tags: ['awesome', 'tags', 'hello'],
      key: {
        public: 'my public key',
        private: 'my private key',
        mykeys: ['public', 'private']
      }
    };
    db.urlPut(url, data, cb);
  }
}

var routes = urlrouter(function (app) {
  app.get('/db/*', function (req, res) {
    var match = req.url.match(/^\/db\/(.*)$/);
    var dbUrl = match[1];
    db.urlGet(dbUrl, function (err, data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    });
  });
});

var app = connect()
  .use(connect.logger('dev'))
  .use(connect.query())
  .use(connect.bodyParser())
  .use(routes)
  .use(connect.static(__dirname + '/public'));

initDb(startServer);

function startServer() {
  var port = parseInt(process.argv[2]) || 3000;
  app.listen(port);
  console.log('Listening on port ' + port);
}
