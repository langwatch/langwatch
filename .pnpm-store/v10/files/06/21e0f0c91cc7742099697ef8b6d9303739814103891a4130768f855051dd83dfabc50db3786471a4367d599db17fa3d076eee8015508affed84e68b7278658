'use strict'

const test = require('tape')
const fastURI = require('..')

const fn = fastURI.equal
const runTest = (t, suite) => {
  suite.forEach(s => {
    const operator = s.result ? '==' : '!='
    t.equal(fn(s.pair[0], s.pair[1]), s.result, `${s.pair[0]} ${operator} ${s.pair[1]}`)
    t.equal(fn(s.pair[1], s.pair[0]), s.result, `${s.pair[1]} ${operator} ${s.pair[0]}`)
  })
}

test('URI Equals', (t) => {
  const suite = [
    { pair: ['example://a/b/c/%7Bfoo%7D', 'eXAMPLE://a/./b/../b/%63/%7bfoo%7d'], result: true }, // test from RFC 3986
    { pair: ['http://example.org/~user', 'http://example.org/%7euser'], result: true } // test from RFC 3987
  ]
  runTest(t, suite)
  t.end()
})

//   test('IRI Equals', (t) => {
//     // example from RFC 3987
//     t.equal(URI.equal('example://a/b/c/%7Bfoo%7D/ros\xE9', 'eXAMPLE://a/./b/../b/%63/%7bfoo%7d/ros%C3%A9', IRI_OPTION), true)
//     t.end()
//   })

test('HTTP Equals', (t) => {
  const suite = [
    // test from RFC 2616
    { pair: ['http://abc.com:80/~smith/home.html', 'http://abc.com/~smith/home.html'], result: true },
    { pair: [{ scheme: 'http', host: 'abc.com', port: 80, path: '/~smith/home.html' }, 'http://abc.com/~smith/home.html'], result: true },
    { pair: ['http://ABC.com/%7Esmith/home.html', 'http://abc.com/~smith/home.html'], result: true },
    { pair: ['http://ABC.com:/%7esmith/home.html', 'http://abc.com/~smith/home.html'], result: true },
    { pair: ['HTTP://ABC.COM', 'http://abc.com/'], result: true },
    // test from RFC 3986
    { pair: ['http://example.com:/', 'http://example.com:80/'], result: true }
  ]
  runTest(t, suite)
  t.end()
})

test('HTTPS Equals', (t) => {
  const suite = [
    { pair: ['https://example.com', 'https://example.com:443/'], result: true },
    { pair: ['https://example.com:/', 'https://example.com:443/'], result: true }
  ]
  runTest(t, suite)
  t.end()
})

test('URN Equals', (t) => {
  const suite = [
    // test from RFC 2141
    { pair: ['urn:foo:a123,456', 'urn:foo:a123,456'], result: true },
    { pair: ['urn:foo:a123,456', 'URN:foo:a123,456'], result: true },
    { pair: ['urn:foo:a123,456', 'urn:FOO:a123,456'], result: true }
  ]

  // Disabling for now as the whole equal logic might need
  // to be refactored
  // t.equal(URI.equal('urn:foo:a123,456', 'urn:foo:A123,456'), false)
  // t.equal(URI.equal('urn:foo:a123%2C456', 'URN:FOO:a123%2c456'), true)

  runTest(t, suite)

  t.throws(() => {
    fn('urn:', 'urn:FOO:a123,456')
  }, 'URN without nid cannot be serialized')

  t.end()
})

test('UUID Equals', (t) => {
  const suite = [
    { pair: ['URN:UUID:F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6', 'urn:uuid:f81d4fae-7dec-11d0-a765-00a0c91e6bf6'], result: true }
  ]

  runTest(t, suite)
  t.end()
})

// test('Mailto Equals', (t) => {
//   // tests from RFC 6068
//   t.equal(URI.equal('mailto:addr1@an.example,addr2@an.example', 'mailto:?to=addr1@an.example,addr2@an.example'), true)
//   t.equal(URI.equal('mailto:?to=addr1@an.example,addr2@an.example', 'mailto:addr1@an.example?to=addr2@an.example'), true)
//   t.end()
// })

test('WS Equal', (t) => {
  const suite = [
    { pair: ['WS://ABC.COM:80/chat#one', 'ws://abc.com/chat'], result: true }
  ]

  runTest(t, suite)
  t.end()
})

test('WSS Equal', (t) => {
  const suite = [
    { pair: ['WSS://ABC.COM:443/chat#one', 'wss://abc.com/chat'], result: true }
  ]

  runTest(t, suite)
  t.end()
})

test('URI Equals tolerates malformed fragments', (t) => {
  t.equal(
    fastURI.equal('http://example.com/#%E0%A4A', 'http://example.com/#%E0%A4A'),
    true,
    'malformed fragment does not throw during equality checks'
  )
  t.end()
})

test('URI Equals — raw UTF-8 char equals its percent-encoded UTF-8 form', (t) => {
  const suite = [
    // BMP characters
    { pair: ['http://example.com/日本', 'http://example.com/%E6%97%A5%E6%9C%AC'], result: true },
    { pair: ['http://example.com/café', 'http://example.com/caf%C3%A9'], result: true },
    { pair: ['http://example.com/€', 'http://example.com/%E2%82%AC'], result: true },
    { pair: ['http://example.com/中文', 'http://example.com/%E4%B8%AD%E6%96%87'], result: true },
    // supplementary plane (emoji, surrogate pairs)
    { pair: ['http://example.com/🚀', 'http://example.com/%F0%9F%9A%80'], result: true },
    { pair: ['http://example.com/😀', 'http://example.com/%F0%9F%98%80'], result: true },
    // mixed encoded + raw in same path
    { pair: ['http://example.com/users/日本/profile', 'http://example.com/users/%E6%97%A5%E6%9C%AC/profile'], result: true },
    { pair: ['http://example.com/a/€/b', 'http://example.com/a/%E2%82%AC/b'], result: true }
  ]
  runTest(t, suite)
  t.end()
})

test('URI Equals — percent-encoded UTF-8 is case-insensitive in hex digits', (t) => {
  const suite = [
    { pair: ['http://example.com/caf%C3%A9', 'http://example.com/caf%c3%a9'], result: true },
    { pair: ['http://example.com/%E6%97%A5', 'http://example.com/%e6%97%a5'], result: true },
    { pair: ['http://example.com/%F0%9F%9A%80', 'http://example.com/%f0%9f%9a%80'], result: true }
  ]
  runTest(t, suite)
  t.end()
})

test('URI Equals — different Unicode code points are not equal', (t) => {
  const suite = [
    { pair: ['http://example.com/日本', 'http://example.com/中文'], result: false },
    { pair: ['http://example.com/café', 'http://example.com/cafe'], result: false },
    { pair: ['http://example.com/🚀', 'http://example.com/🎉'], result: false }
  ]
  runTest(t, suite)
  t.end()
})

test('URI Equals — Latin-1 byte is not equal to UTF-8 multi-byte encoding', (t) => {
  // Parser-differential guard: %C3%A9 (UTF-8 for "é") must NOT equal %E9
  // (raw Latin-1 byte). The old escape() emitted single Latin-1 bytes for
  // non-ASCII, which would have made these incorrectly compare equal in a
  // round-tripped URI.
  const suite = [
    { pair: ['http://example.com/caf%C3%A9', 'http://example.com/caf%E9'], result: false },
    { pair: ['http://example.com/%E6%97%A5', 'http://example.com/%E6'], result: false }
  ]
  runTest(t, suite)
  t.end()
})
