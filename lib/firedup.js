var dbUtil = require('levelup/lib/util')
  , toEncoding = dbUtil.toEncoding
  , toSlice = dbUtil.toSlice
  , Stream = require('stream')
  , deepEquals = require('deep-equal')
  , bytewise = require('byteup')()
  , sublevel = require('level-sublevel')
  , livestream = require('level-live-stream')
  , uid = require('./uid')
  , _ = require('underscore');

module.exports = function (db) {
  db.options.keyEncoding = 'bytewise';
  db.options.valueEncoding = 'json';

  db.urlPut = urlPut.bind(null, db);
  db.urlGet = urlGet.bind(null, db);
  db.urlPush = urlPush.bind(null, db);
  db.urlWatch = urlWatch.bind(null, db);
  db.urlDel = urlDel.bind(null, db);

  function urlWatch(db, url) {
    var s = new Stream;
    var parts = url.split('/');
    var encodedStart, encodedEnd;
    var checker = function(key) {
      var encodedKey;
      if (typeof key === 'object' && key instanceof Buffer) {
        key = toEncoding[db.options.keyEncoding](key);
      }
      encodedKey = toSlice[db.options.keyEncoding](key.concat(null));

      return bytewise.compare(encodedKey, encodedStart) >= 0 && bytewise.compare(encodedKey, encodedEnd) <= 0;
      //return encodedKey >= encodedStart && encodedKey <= encodedEnd;
    }
    checker.old = false;
    checker.start = parts.concat(null);
    checker.end = parts.concat(undefined);
    encodedStart = toSlice[db.options.keyEncoding](checker.start);
    encodedEnd = toSlice[db.options.keyEncoding](checker.end);

    s.readable = true;

    var cache;
    propGet(db, parts, function (err, data) {
      cache = data || null;
      s.emit('value', cache);

      function processChange(ch) {
        if (typeof ch.key === 'object' && ch.key instanceof Buffer) {
          ch.key = toEncoding[db.options.keyEncoding](ch.key);
          if (ch.value !== undefined) {
            ch.value = toEncoding[db.options.valueEncoding](ch.value);
          }
        }
        var old = JSON.parse(JSON.stringify(cache));
        cache = updateObj(parts, cache, ch);
        var oldKeys = (old === null || typeof old !== 'object') ? [] : Object.keys(old);
        var newKeys = (cache === null || typeof cache !== 'object') ? [] : Object.keys(cache);
        if (ch.type === 'put') {
          if (newKeys.length > oldKeys.length) {
            var diff = _.difference(oldKeys, newKeys);
            newKeys.forEach(function (newKey) {
              if (cache !== null && newKey in cache &&
                  old !== null && !(newKey in old)) {
                s.emit('child_added', cache[newKey]);
              }
            });
          } else if (newKeys.length == oldKeys.length) {
            newKeys.forEach(function (key) {
              if (!deepEquals(old[key], cache[key])) {
                s.emit('child_changed', cache[key]);
              }
            });
          }
        } else if (ch.type === 'del') {
          if (newKeys.length < oldKeys.length) {
            var diff = _.difference(oldKeys, newKeys);
            oldKeys.forEach(function (oldKey) {
              if (oldKey in old && !(oldKey in cache)) {
                s.emit('child_removed', old[oldKey]);
              }
            });
          }
        }
      }

      db
        .on('batch', function (ops) {
          ops.forEach(function (ch) {
            if (checker(ch.key)) {
              processChange(ch);
            }
          });
          s.emit('value', cache);
        })
        .on('put', function (key, value) {
          if (checker(key)) {
            processChange({ type: 'put', key: key, value: value });
            s.emit('value', cache);
          }
        })
        .on('del', function (key) {
          if (checker(key)) {
            processChange({ type: 'del', key: key });
            s.emit('value', cache);
          }
        });
    });

    return s;
  }

  function urlPush(db, url, data, cb) {
    var parts = url.split('/');
    var key = uid();
    db.put(parts.concat(key), data, cb);
    return key;
  }

  function urlPut(db, url, data, cb) {
    var parts = url.split('/');
    propPut(db, parts, data, cb);
  }

  function urlDel(db, url, cb) {
    var parts = url.split('/');
    propDel(db, parts, cb);
  }

  function propDel(db, parts, cb) {
    deleteChildren(db, parts, function (err, _ops) {
      if (err) return cb(err);
      var ops = [ { type: 'del', key: parts } ];
      ops = ops.concat(_ops);
      db.batch(ops, cb)
    });
  }

  function deleteChildren(db, parts, cb) {
    var ops = [];
    db.createReadStream({
        start: parts.concat(null),
        end: parts.concat(undefined)
      })
      .on('data', function (data) {
        ops.push({ type: 'del', key: data.key });
      })
      .on('end', function () {
        cb(null, ops);
      });
  }

  function saveObj(db, parts, data, cb) {
    var ops = [];
    deleteChildren(db, parts, function (err, _ops) {
      ops = ops.concat(_ops);
      if (data !== null && typeof data === 'object') {
        saveChildren();
      } else {
        ops.push({ type: 'put', key: parts, value: data });
        cb(null, ops);
      }
    });

    function saveChildren() {
      var keys = Object.keys(data);
      var count = keys.length;
      keys.forEach(function (key) {
        var value = data[key];
        if (typeof value === 'object') {
          saveObj(db, parts.concat(key), value, function (err, _ops) {
            ops = ops.concat(_ops);
            --count || cb(null, ops);
          });
        } else {
          ops.push({ type: 'put', key: parts.concat(key), value: data[key] });
          --count || cb(null, ops);
        }
      });
    }
  }

  function propPut(db, parts, data, cb) {
    saveObj(db, parts, data, function (err, ops) {
      db.batch(ops, cb);
    });
  }

  function urlGet(db, url, cb) {
    var parts = url.split('/');
    propGet(db, parts, cb);
  }

  function propGet(db, parts, cb) {
    var found = 0;
    var obj = {};
    db.get(parts, function (err, data) {
      if (!err) {
        cb(null, data);
      } else if (err && err.name === 'NotFoundError') {
        db.createReadStream({
            start: parts.concat(null),
            end: parts.concat(undefined)
          })
          .on('data', function (data) {
            found++;
            obj = updateObjPut(parts, obj, data);
          })
          .on('end', function () {
            cb(null, (found && obj) || undefined);
          });
      } else {
        cb(err);
      }
    });
  }

  function updateObj(parts, obj, ch) {
    if (ch.type === 'put') {
      obj = updateObjPut(parts, obj, ch);
    } else if (ch.type === 'del') {
      obj = updateObjDel(parts, obj, ch);
    }

    return obj;
  }

  function updateObjPut(parts, obj, ch) {
    var _keys = ch.key.slice(parts.length)
    var ptr = obj;
    if (_keys.length) {
      _keys.forEach(function (_key, i) {
        if (typeof ptr !== 'object' || ptr === null) {
          obj = ptr = {};
        }

        if (!(_key in ptr)) {
          ptr[_key] = {};
        }
        if (i < _keys.length - 1) {
          ptr = ptr[_key];
        } else {
          ptr[_key] = ch.value;
        }
      });
    } else {
      obj = ch.value;
    }

    return obj;
  }

  function updateObjDel(parts, obj, ch) {
    var _keys = ch.key.slice(parts.length)
    var ptr = obj;
    _keys.forEach(function (_key, i) {
      if (typeof ptr !== 'object' || ptr === null) {
        return;
      }

      if (!(_key in ptr)) {
        ptr[_key] = {};
      }
      if (i < _keys.length - 1) {
        ptr = ptr[_key];
      } else {
        delete ptr[_key];
      }
    });

    return obj;
  }

  return sublevel(db);
};
