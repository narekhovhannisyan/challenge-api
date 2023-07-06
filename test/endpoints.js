process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('create target and retrieve it', function (t) {
  var targetData = {
    id: 'target1',
    maxAcceptsPerDay: 5,
    url: 'http://example.com',
    accept: {
      geoState: {
        $in: ['NY', 'CA']
      },
      hour: {
        $in: [9, 10, 11]
      }
    }
  }

  servertest(server(), '/api/targets', { method: 'POST', json: targetData }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')

    var targetId = res.body.id

    servertest(server(), `/api/target/${targetId}`, { method: 'GET' }, (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.deepEqual(res.body, targetData, 'retrieved target data matches')

      t.end()
    })
  })
})

test.serial.cb('create target and update it', function (t) {
  var targetData = {
    id: 'target1',
    maxAcceptsPerDay: 5,
    url: 'http://example.com',
    accept: {
      geoState: {
        $in: ['NY', 'CA']
      },
      hour: {
        $in: [9, 10, 11]
      }
    }
  }

  servertest(server(), '/api/targets', { method: 'POST', json: targetData }, (err, res) => {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')

    var updatedTargetData = {
      ...targetData,
      maxAcceptsPerDay: 10
    }

    servertest(server(), `/api/target/${targetData.id}`, { method: 'POST', json: updatedTargetData }, (err, res) => {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')

      servertest(server(), `/api/target/${targetData.id}`, { method: 'GET' }, (err, res) => {
        t.falsy(err, 'no error')
        t.is(res.statusCode, 200, 'correct statusCode')
        t.deepEqual(res.body, updatedTargetData, 'updated target data matches')

        t.end()
      })
    })
  })
})
