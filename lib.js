'use strict'

/* eslint no-prototype-builtins: 0 */

const split = require('split2')
const { Client } = require('@elastic/elasticsearch')
const Parse = require('fast-json-parse')

function pinoElasticSearch (opts) {
  if (opts['bulk-size']) {
    process.emitWarning('The "bulk-size" option has been deprecated, "flush-bytes" instead')
    delete opts['bulk-size']
  }

  const splitter = split(function (line) {
    var parsed = new Parse(line)
    if (parsed.err) {
      this.emit('unknown', line, parsed.err)
      return
    }
    var value = parsed.value
    if (typeof value === 'boolean') {
      this.emit('unknown', line, 'Boolean value ignored')
      return
    }
    if (value === null) {
      this.emit('unknown', line, 'Null value ignored')
      return
    }
    if (typeof value !== 'object') {
      value = {
        data: value,
        time: setDateTimeString(value)
      }
    } else {
      if (value['@timestamp'] === undefined) {
        value.time = setDateTimeString(value)
      }
    }

    function setDateTimeString (value) {
      if (typeof value === 'object' && value.hasOwnProperty('time')) {
        if (
          (typeof value.time === 'string' && value.time.length) ||
          (typeof value.time === 'number' && value.time >= 0)
        ) {
          return new Date(value.time).toISOString()
        }
      }
      return new Date().toISOString()
    }
    return value
  })

  const client = new Client({ node: opts.node, auth: opts.auth, cloud: opts.cloud })

  const esVersion = Number(opts['es-version']) || 7
  const index = opts.index || 'pino'
  const buildIndexName = typeof index === 'function' ? index : null
  const type = esVersion >= 7 ? undefined : (opts.type || 'log')
  const b = client.helpers.bulk({
    datasource: splitter,
    flushBytes: opts['flush-bytes'] || 1000,
    refreshOnCompletion: getIndexName(),
    onDocument (doc) {
      return {
        index: {
          _index: getIndexName(doc.time || doc['@timestamp']),
          _type: type
        }
      }
    },
    onDrop (doc) {
      const error = new Error('Dropped document')
      error.document = doc
      splitter.emit('insertError', error)
    }
  })

  b.then(
    (stats) => splitter.emit('insert', stats),
    (err) => splitter.emit('error', err)
  )

  function getIndexName (time = new Date().toISOString()) {
    if (buildIndexName) {
      return buildIndexName(time)
    }
    return index.replace('%{DATE}', time.substring(0, 10))
  }

  return splitter
}

module.exports = pinoElasticSearch
