var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')

var redis = require('./redis')
var version = require('../package.json').version

var router = HttpHashRouter()
var logger = ReqLogger({ version: version })
var health = healthPoint({ version: version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

var RedisClient = require('./redis')
var hash = 'testHash'

router.set('/favicon.ico', empty)

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)

  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'

  console[logType]({
    err: err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}

/**
 * Targets storage.
 */
var storage = {}

/**
 * @api targets API endpoints.
 */
router.set('/api/targets', function (req, res) {
  let body = ''

  req.on('data', (chunk) => body += chunk)
  req.on('end', () => {
    /**
     * Create target.
     */
    if (req.method === 'POST') {
      var parsedBody = JSON.parse(body)
      var id = parsedBody.id
      storage[id] = parsedBody

      return RedisClient.hset(hash, id, 0, (error, value) => {
        if (error) {
          console.error(error)
        }

        return sendJson(req, res, storage[id])
      })
    }

    /**
     * Get all targets.
     */
    if (req.method === 'GET') {
      return sendJson(req, res, storage)
    }

    response.end({});
  });
})

/**
 * Checks if rate limit is reached.
 * If not, then increments value and returns target.
 * @param {number} id 
 * @param {function} cb
 * @returns {Promise.<any>}
 */
function checkIfLimitReachedAndReturn (id, cb) {
  return RedisClient.hget(hash, id, (error, value) => {
    if (error) {
      console.error(error)
    }

    const status = parseInt(value) < parseInt(storage[id].maxAcceptsPerDay)

    if (status) {
      return RedisClient.hincrby(hash, id, 1, (error, value) => {
        return cb(storage[id])
      })
    }

    return cb({})
  })
}

/**
 * @api target/:id API endpoints.
 */
router.set('/api/target/:id', function (req, res, params) {
  let body = ''

  req.on('data', (chunk) => body += chunk)
  req.on('end', () => {
    var { id } = params.params

    /**
     * Get target by `id`.
     */
    if (req.method === 'GET') {
      return checkIfLimitReachedAndReturn(id, (data) => sendJson(req, res, data))
    }

    /**
     * Update target by `id`. 
     * @todo better to use PUT method instead,
     */
    if (req.method === 'POST') { 
      var parsedBody = JSON.parse(body)
      storage[id] = parsedBody

      return checkIfLimitReachedAndReturn(id, (data) => sendJson(req, res, data))
    }
  })
})

function mergeAndFlatten(array) {
  return array.reduce((result, current) => {
    return result.concat(current);
  }, []).filter((value, index, self) => {
    return self.indexOf(value) === index;
  });
}

/**
 * @api route API endpoints.
 */
router.set('/route', function (req, res, next) {
  let body = ''

  req.on('data', (chunk) => body += chunk)
  req.on('end', () => {
    /**
     * Decision maker.
     */
    if (req.method === 'POST') {
      var parsedBody = JSON.parse(body)
      var geoState = parsedBody.geoState

      var currentTime = new Date()
      var hour = currentTime.getHours()

      var data = Object.values(storage)

      var countries = mergeAndFlatten(data.map((record) => record.accept.geoState.$in))
      var hours = mergeAndFlatten(data.map((record) => record.accept.hour.$in))
      
      if (!countries.includes(geoState)) {
        return sendJson(req, res, { 'decision' : 'reject' })
      }

      // if (!hours.includes(hour)) {
      //   return sendJson(req, res, { 'decision' : 'reject' })
      // }

      return RedisClient.hgetall(hash, (error, result) => {
        if (error) {
          console.error(error);
        } else {
          var values = Object.values(result)
          var valuesSmaller10 = values.filter((value) => value < 10)

          if (valuesSmaller10.length === 0) {
            return sendJson(req, res, { 'decision' : 'reject' })
          }

          var keys = Object.keys(result)
          var sortedKeys = keys.sort((a, b) => b - a)
          
          return sendJson(req, res, storage[sortedKeys[0]].url)
        }
      });
    }
  })
})
