'use strict'

/** @type {(value: string) => boolean} */
const isUUID = RegExp.prototype.test.bind(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu)

/** @type {(value: string) => boolean} */
const isIPv4 = RegExp.prototype.test.bind(/^(?:(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]\d|\d)$/u)

/** @type {(value: string) => boolean} */
const isHexPair = RegExp.prototype.test.bind(/^[\da-f]{2}$/iu)

/** @type {(value: string) => boolean} */
const isUnreserved = RegExp.prototype.test.bind(/^[\da-z\-._~]$/iu)

/** @type {(value: string) => boolean} */
const isPathCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/]$/iu)

/** @type {(value: string) => boolean} */
const isQueryFragmentCharacter = RegExp.prototype.test.bind(/^[\da-z\-._~!$&'()*+,;=:@/?]$/iu)

/**
 * @param {Array<string>} input
 * @returns {string}
 */
function stringArrayToHexStripped (input) {
  let acc = ''
  let code = 0
  let i = 0

  for (i = 0; i < input.length; i++) {
    code = input[i].charCodeAt(0)
    if (code === 48) {
      continue
    }
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) {
      return ''
    }
    acc += input[i]
    break
  }

  for (i += 1; i < input.length; i++) {
    code = input[i].charCodeAt(0)
    if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) {
      return ''
    }
    acc += input[i]
  }
  return acc
}

/**
 * @typedef {Object} GetIPV6Result
 * @property {boolean} error - Indicates if there was an error parsing the IPv6 address.
 * @property {string} address - The parsed IPv6 address.
 * @property {string} [zone] - The zone identifier, if present.
 */

/**
 * @param {string} value
 * @returns {boolean}
 */
const nonSimpleDomain = RegExp.prototype.test.bind(/[^!"$&'()*+,\-.;=_`a-z{}~]/u)

/**
 * @param {Array<string>} buffer
 * @returns {boolean}
 */
function consumeIsZone (buffer) {
  buffer.length = 0
  return true
}

/**
 * @param {Array<string>} buffer
 * @param {Array<string>} address
 * @param {GetIPV6Result} output
 * @returns {boolean}
 */
function consumeHextets (buffer, address, output) {
  if (buffer.length) {
    const hex = stringArrayToHexStripped(buffer)
    if (hex !== '') {
      address.push(hex)
    } else {
      output.error = true
      return false
    }
    buffer.length = 0
  }
  return true
}

/**
 * @param {string} input
 * @returns {GetIPV6Result}
 */
function getIPV6 (input) {
  let tokenCount = 0
  const output = { error: false, address: '', zone: '' }
  /** @type {Array<string>} */
  const address = []
  /** @type {Array<string>} */
  const buffer = []
  let endipv6Encountered = false
  let endIpv6 = false

  let consume = consumeHextets

  for (let i = 0; i < input.length; i++) {
    const cursor = input[i]
    if (cursor === '[' || cursor === ']') { continue }
    if (cursor === ':') {
      if (endipv6Encountered === true) {
        endIpv6 = true
      }
      if (!consume(buffer, address, output)) { break }
      if (++tokenCount > 7) {
        // not valid
        output.error = true
        break
      }
      if (i > 0 && input[i - 1] === ':') {
        endipv6Encountered = true
      }
      address.push(':')
      continue
    } else if (cursor === '%') {
      if (!consume(buffer, address, output)) { break }
      // switch to zone detection
      consume = consumeIsZone
    } else {
      buffer.push(cursor)
      continue
    }
  }
  if (buffer.length) {
    if (consume === consumeIsZone) {
      output.zone = buffer.join('')
    } else if (endIpv6) {
      address.push(buffer.join(''))
    } else {
      address.push(stringArrayToHexStripped(buffer))
    }
  }
  output.address = address.join('')
  return output
}

/**
 * @typedef {Object} NormalizeIPv6Result
 * @property {string} host - The normalized host.
 * @property {string} [escapedHost] - The escaped host.
 * @property {boolean} isIPV6 - Indicates if the host is an IPv6 address.
 */

/**
 * @param {string} host
 * @returns {NormalizeIPv6Result}
 */
function normalizeIPv6 (host) {
  if (findToken(host, ':') < 2) { return { host, isIPV6: false } }
  const ipv6 = getIPV6(host)

  if (!ipv6.error) {
    let newHost = ipv6.address
    let escapedHost = ipv6.address
    if (ipv6.zone) {
      newHost += '%' + ipv6.zone
      escapedHost += '%25' + ipv6.zone
    }
    return { host: newHost, isIPV6: true, escapedHost }
  } else {
    return { host, isIPV6: false }
  }
}

/**
 * @param {string} str
 * @param {string} token
 * @returns {number}
 */
function findToken (str, token) {
  let ind = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i] === token) ind++
  }
  return ind
}

/**
 * @param {string} path
 * @returns {string}
 *
 * @see https://datatracker.ietf.org/doc/html/rfc3986#section-5.2.4
 */
function removeDotSegments (path) {
  let input = path
  const output = []
  let nextSlash = -1
  let len = 0

  // eslint-disable-next-line no-cond-assign
  while (len = input.length) {
    if (len === 1) {
      if (input === '.') {
        break
      } else if (input === '/') {
        output.push('/')
        break
      } else {
        output.push(input)
        break
      }
    } else if (len === 2) {
      if (input[0] === '.') {
        if (input[1] === '.') {
          break
        } else if (input[1] === '/') {
          input = input.slice(2)
          continue
        }
      } else if (input[0] === '/') {
        if (input[1] === '.') {
          output.push('/')
          break
        }
      }
    } else if (len === 3) {
      if (input === '/..') {
        if (output.length !== 0) {
          output.pop()
        }
        output.push('/')
        break
      }
    }
    if (input[0] === '.') {
      if (input[1] === '.') {
        if (input[2] === '/') {
          input = input.slice(3)
          continue
        }
      } else if (input[1] === '/') {
        input = input.slice(2)
        continue
      }
    } else if (input[0] === '/') {
      if (input[1] === '.') {
        if (input[2] === '/') {
          input = input.slice(2)
          continue
        } else if (input[2] === '.') {
          if (input[3] === '/') {
            input = input.slice(3)
            if (output.length !== 0) {
              output.pop()
            }
            continue
          }
        }
      }
    }

    // Rule 2E: Move normal path segment to output
    if ((nextSlash = input.indexOf('/', 1)) === -1) {
      output.push(input)
      break
    } else {
      output.push(input.slice(0, nextSlash))
      input = input.slice(nextSlash)
    }
  }

  return output.join('')
}

/**
 * Re-escape RFC 3986 gen-delims that must not appear literally in the host.
 * After the URI regex parses, these characters cannot be literal in the host
 * field, so any that appear after decoding came from percent-encoding and
 * must be restored to prevent authority structure changes.
 *
 * @param {string} host
 * @param {boolean} isIP - true for IPv4/IPv6 hosts (skip colon re-escaping)
 * @returns {string}
 */
const HOST_DELIMS = { '@': '%40', '/': '%2F', '?': '%3F', '#': '%23', ':': '%3A' }
const HOST_DELIM_RE = /[@/?#:]/g
const HOST_DELIM_NO_COLON_RE = /[@/?#]/g

function reescapeHostDelimiters (host, isIP) {
  const re = isIP ? HOST_DELIM_NO_COLON_RE : HOST_DELIM_RE
  re.lastIndex = 0
  return host.replace(re, (ch) => HOST_DELIMS[ch])
}

/**
 * Normalizes percent escapes and optionally decodes only unreserved ASCII bytes.
 * Reserved delimiters such as `%2F` and `%2E` stay escaped.
 *
 * @param {string} input
 * @param {boolean} [decodeUnreserved=false]
 * @returns {string}
 */
function normalizePercentEncoding (input, decodeUnreserved = false) {
  if (input.indexOf('%') === -1) {
    return input
  }

  let output = ''

  for (let i = 0; i < input.length; i++) {
    if (input[i] === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3)
      if (isHexPair(hex)) {
        const normalizedHex = hex.toUpperCase()
        const decoded = String.fromCharCode(parseInt(normalizedHex, 16))

        if (decodeUnreserved && isUnreserved(decoded)) {
          output += decoded
        } else {
          output += '%' + normalizedHex
        }

        i += 2
        continue
      }
    }

    output += input[i]
  }

  return output
}

/** Pre-built `%XX` strings for every byte. Avoids per-call hex math/concat. */
const BYTE_HEX = new Array(256)
{
  const HEX_DIGITS = '0123456789ABCDEF'
  for (let i = 0; i < 256; i++) {
    BYTE_HEX[i] = '%' + HEX_DIGITS[i >> 4] + HEX_DIGITS[i & 0xF]
  }
}

/**
 * Mirrors the pass-through set of the deprecated `escape()` global:
 * `A-Z a-z 0-9 * + - . / @ _`. Keeps drop-in semantics for ASCII input.
 *
 * @param {number} cp
 * @returns {boolean}
 */
function isEscapeSafe (cp) {
  return (
    (cp >= 0x30 && cp <= 0x39) ||
    (cp >= 0x41 && cp <= 0x5A) ||
    (cp >= 0x61 && cp <= 0x7A) ||
    cp === 0x2A || cp === 0x2B || cp === 0x2D || cp === 0x2E ||
    cp === 0x2F || cp === 0x40 || cp === 0x5F
  )
}

/**
 * RFC 3986 percent-encode a non-ASCII Unicode code point as UTF-8 bytes.
 * Caller handles the ASCII branch inline for speed.
 *
 * @param {number} cp - Unicode code point (>= 0x80, <= 0x10FFFF)
 * @returns {string}
 */
function percentEncodeNonAscii (cp) {
  if (cp < 0x800) {
    return BYTE_HEX[0xC0 | (cp >> 6)] +
           BYTE_HEX[0x80 | (cp & 0x3F)]
  }
  if (cp < 0x10000) {
    return BYTE_HEX[0xE0 | (cp >> 12)] +
           BYTE_HEX[0x80 | ((cp >> 6) & 0x3F)] +
           BYTE_HEX[0x80 | (cp & 0x3F)]
  }
  return BYTE_HEX[0xF0 | (cp >> 18)] +
         BYTE_HEX[0x80 | ((cp >> 12) & 0x3F)] +
         BYTE_HEX[0x80 | ((cp >> 6) & 0x3F)] +
         BYTE_HEX[0x80 | (cp & 0x3F)]
}

/**
 * Normalizes path data without turning reserved escapes into live path syntax.
 * Valid escapes are uppercased, raw unsafe characters are escaped, and only
 * unreserved bytes that are not `.` are decoded.
 *
 * @param {string} input
 * @returns {string}
 */
function normalizePathEncoding (input) {
  let output = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3)
      if (isHexPair(hex)) {
        const normalizedHex = hex.toUpperCase()
        const decoded = String.fromCharCode(parseInt(normalizedHex, 16))

        if (decoded !== '.' && isUnreserved(decoded)) {
          output += decoded
        } else {
          output += '%' + normalizedHex
        }

        i += 2
        continue
      }
    }

    if (isPathCharacter(ch)) {
      output += ch
    } else {
      const code = input.charCodeAt(i)
      if (code < 0x80) {
        output += isEscapeSafe(code) ? ch : BYTE_HEX[code]
      } else if (code < 0xD800 || code > 0xDFFF) {
        output += percentEncodeNonAscii(code)
      } else if (code <= 0xDBFF && i + 1 < input.length) {
        const low = input.charCodeAt(i + 1)
        if (low >= 0xDC00 && low <= 0xDFFF) {
          output += percentEncodeNonAscii(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00))
          i++
        } else {
          output += percentEncodeNonAscii(0xFFFD)
        }
      } else {
        output += percentEncodeNonAscii(0xFFFD)
      }
    }
  }

  return output
}

/**
 * Normalizes the percent-encoding of a query or fragment component.
 *
 * Like `normalizePathEncoding`, but uses the query/fragment character set
 * (which additionally allows `?`) and decodes `.` since it has no dot-segment
 * meaning outside of a path.
 *
 * @param {string} input
 * @returns {string}
 */
function normalizeQueryFragmentEncoding (input) {
  let output = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3)
      if (isHexPair(hex)) {
        const normalizedHex = hex.toUpperCase()
        const decoded = String.fromCharCode(parseInt(normalizedHex, 16))

        if (isUnreserved(decoded)) {
          output += decoded
        } else {
          output += '%' + normalizedHex
        }

        i += 2
        continue
      }
    }

    if (isQueryFragmentCharacter(ch)) {
      output += ch
    } else {
      const code = input.charCodeAt(i)
      if (code < 0x80) {
        output += isEscapeSafe(code) ? ch : BYTE_HEX[code]
      } else if (code < 0xD800 || code > 0xDFFF) {
        output += percentEncodeNonAscii(code)
      } else if (code <= 0xDBFF && i + 1 < input.length) {
        const low = input.charCodeAt(i + 1)
        if (low >= 0xDC00 && low <= 0xDFFF) {
          output += percentEncodeNonAscii(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00))
          i++
        } else {
          output += percentEncodeNonAscii(0xFFFD)
        }
      } else {
        output += percentEncodeNonAscii(0xFFFD)
      }
    }
  }

  return output
}

/**
 * Escapes a component while preserving existing valid percent escapes.
 *
 * @param {string} input
 * @returns {string}
 */
function escapePreservingEscapes (input) {
  let output = ''

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '%' && i + 2 < input.length) {
      const hex = input.slice(i + 1, i + 3)
      if (isHexPair(hex)) {
        output += '%' + hex.toUpperCase()
        i += 2
        continue
      }
    }

    const code = input.charCodeAt(i)
    if (code < 0x80) {
      output += isEscapeSafe(code) ? ch : BYTE_HEX[code]
    } else if (code < 0xD800 || code > 0xDFFF) {
      output += percentEncodeNonAscii(code)
    } else if (code <= 0xDBFF && i + 1 < input.length) {
      const low = input.charCodeAt(i + 1)
      if (low >= 0xDC00 && low <= 0xDFFF) {
        output += percentEncodeNonAscii(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00))
        i++
      } else {
        output += percentEncodeNonAscii(0xFFFD)
      }
    } else {
      output += percentEncodeNonAscii(0xFFFD)
    }
  }

  return output
}

/**
 * @param {import('../types/index').URIComponent} component
 * @returns {string|undefined}
 */
function recomposeAuthority (component) {
  const uriTokens = []

  if (component.userinfo !== undefined) {
    uriTokens.push(component.userinfo)
    uriTokens.push('@')
  }

  if (component.host !== undefined) {
    let host = unescape(component.host)
    if (!isIPv4(host)) {
      const ipV6res = normalizeIPv6(host)
      if (ipV6res.isIPV6 === true) {
        host = `[${ipV6res.escapedHost}]`
      } else {
        host = reescapeHostDelimiters(host, false)
      }
    }
    uriTokens.push(host)
  }

  if (typeof component.port === 'number' || typeof component.port === 'string') {
    uriTokens.push(':')
    uriTokens.push(String(component.port))
  }

  return uriTokens.length ? uriTokens.join('') : undefined
};

module.exports = {
  nonSimpleDomain,
  recomposeAuthority,
  reescapeHostDelimiters,
  normalizePercentEncoding,
  normalizePathEncoding,
  normalizeQueryFragmentEncoding,
  escapePreservingEscapes,
  removeDotSegments,
  isIPv4,
  isUUID,
  normalizeIPv6,
  stringArrayToHexStripped
}
