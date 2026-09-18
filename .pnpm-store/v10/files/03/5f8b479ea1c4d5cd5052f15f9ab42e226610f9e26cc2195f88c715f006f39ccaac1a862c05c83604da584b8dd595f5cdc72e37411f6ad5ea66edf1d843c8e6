'use strict'

const test = require('tape')
const fastURI = require('..')

test('scheme is normalized to lowercase (RFC 3986 §6.2.2.1)', (t) => {
  // parse lowercases the scheme, consistent with how it already lowercases the host
  t.equal(fastURI.parse('HTTP://EXAMPLE.com/Path').scheme, 'http', 'parse lowercases an uppercase scheme')
  t.equal(fastURI.parse('HtTpS://example.com').scheme, 'https', 'parse lowercases a mixed-case scheme')

  // normalize emits a lowercase scheme (matches the already-lowercased host)
  t.equal(fastURI.normalize('HTTP://EXAMPLE.com/p'), 'http://example.com/p', 'normalize lowercases the scheme')
  t.equal(fastURI.normalize('HtTp://Example.COM/'), 'http://example.com/', 'normalize lowercases a mixed-case scheme')

  t.end()
})
