// src/utils/ipaddr.ts
var expandIPv6 = (ipV6) => {
  const sections = ipV6.split(":");
  if (IPV4_REGEX.test(sections.at(-1))) {
    sections.splice(
      -1,
      1,
      ...convertIPv6BinaryToString(convertIPv4ToBinary(sections.at(-1))).substring(2).split(":")
      // => ['7f00', '0001']
    );
  }
  for (let i = 0; i < sections.length; i++) {
    const node = sections[i];
    if (node !== "") {
      sections[i] = node.padStart(4, "0");
    } else {
      while (sections[i + 1] === "") {
        sections.splice(i + 1, 1);
      }
      sections[i] = new Array(8 - sections.length + 1).fill("0000").join(":");
    }
  }
  return sections.join(":");
};
var IPV4_OCTET_PART = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
var IPV4_REGEX = new RegExp(`^(?:${IPV4_OCTET_PART}\\.){3}${IPV4_OCTET_PART}$`);
var INVALID_IP_ADDRESS_ERROR_CODE = "ERR_INVALID_IP_ADDRESS";
var CHAR_CODE_0 = 48;
var CHAR_CODE_9 = 57;
var CHAR_CODE_A = 65;
var CHAR_CODE_F = 70;
var CHAR_CODE_a = 97;
var CHAR_CODE_f = 102;
var CHAR_CODE_DOT = 46;
var CHAR_CODE_COLON = 58;
var CHAR_CODE_PERCENT = 37;
var distinctRemoteAddr = (remoteAddr) => {
  if (IPV4_REGEX.test(remoteAddr)) {
    return "IPv4";
  }
  if (remoteAddr.includes(":")) {
    return "IPv6";
  }
};
var createInvalidIPAddressError = (message) => {
  const error = new TypeError(message);
  error.code = INVALID_IP_ADDRESS_ERROR_CODE;
  return error;
};
var throwInvalidIPv4Address = (ipv4) => {
  throw createInvalidIPAddressError(`Invalid IPv4 address: ${ipv4}`);
};
var throwInvalidIPv6Address = (ipv6) => {
  throw createInvalidIPAddressError(`Invalid IPv6 address: ${ipv6}`);
};
var parseIPv4ToBinary = (ipv4, start, end, onInvalid) => {
  let result = 0n;
  let octets = 0;
  let octet = 0;
  let digits = 0;
  let firstDigit = 0;
  for (let i = start; i <= end; i++) {
    const code = i < end ? ipv4.charCodeAt(i) : CHAR_CODE_DOT;
    if (code >= CHAR_CODE_0 && code <= CHAR_CODE_9) {
      if (digits === 0) {
        firstDigit = code;
      } else if (firstDigit === CHAR_CODE_0) {
        onInvalid();
      }
      octet = octet * 10 + code - CHAR_CODE_0;
      if (octet > 255) {
        onInvalid();
      }
      digits++;
      continue;
    }
    if (code !== CHAR_CODE_DOT || digits === 0 || octets === 4) {
      onInvalid();
    }
    result = (result << 8n) + BigInt(octet);
    octets++;
    octet = 0;
    digits = 0;
  }
  if (octets !== 4) {
    onInvalid();
  }
  return result;
};
var parseIPv6HexCode = (code) => {
  if (code >= CHAR_CODE_0 && code <= CHAR_CODE_9) {
    return code - CHAR_CODE_0;
  }
  if (code >= CHAR_CODE_A && code <= CHAR_CODE_F) {
    return code - CHAR_CODE_A + 10;
  }
  if (code >= CHAR_CODE_a && code <= CHAR_CODE_f) {
    return code - CHAR_CODE_a + 10;
  }
  return -1;
};
var isIPv6LinkLocal = (ipv6binary) => ipv6binary >> 118n === 0x3fan;
var convertIPv4ToBinary = (ipv4) => {
  return parseIPv4ToBinary(ipv4, 0, ipv4.length, () => throwInvalidIPv4Address(ipv4));
};
var convertIPv6ToBinary = (ipv6) => {
  const length = ipv6.length;
  const sections = [];
  let hasZoneId = false;
  let compressAt = -1;
  let index = 0;
  if (length === 0) {
    throwInvalidIPv6Address(ipv6);
  }
  while (index < length) {
    if (sections.length > 8) {
      throwInvalidIPv6Address(ipv6);
    }
    let code = ipv6.charCodeAt(index);
    if (code === CHAR_CODE_PERCENT) {
      if (index + 1 === length) {
        throwInvalidIPv6Address(ipv6);
      }
      hasZoneId = true;
      break;
    }
    if (code === CHAR_CODE_COLON) {
      if (index + 1 < length && ipv6.charCodeAt(index + 1) === CHAR_CODE_COLON) {
        if (compressAt !== -1) {
          throwInvalidIPv6Address(ipv6);
        }
        compressAt = sections.length;
        index += 2;
        continue;
      }
      throwInvalidIPv6Address(ipv6);
    }
    let value = 0;
    let digits = 0;
    const sectionStart = index;
    while (index < length) {
      code = ipv6.charCodeAt(index);
      const hex = parseIPv6HexCode(code);
      if (hex === -1) {
        break;
      }
      if (digits === 4) {
        throwInvalidIPv6Address(ipv6);
      }
      value = value << 4 | hex;
      digits++;
      index++;
    }
    if (index < length && ipv6.charCodeAt(index) === CHAR_CODE_DOT) {
      let ipv4End = length;
      for (let i = index; i < length; i++) {
        if (ipv6.charCodeAt(i) === CHAR_CODE_PERCENT) {
          if (i + 1 === length) {
            throwInvalidIPv6Address(ipv6);
          }
          hasZoneId = true;
          ipv4End = i;
          break;
        }
      }
      const ipv4 = parseIPv4ToBinary(
        ipv6,
        sectionStart,
        ipv4End,
        () => throwInvalidIPv6Address(ipv6)
      );
      sections.push(Number(ipv4 >> 16n & 0xffffn), Number(ipv4 & 0xffffn));
      index = length;
      break;
    }
    if (digits === 0) {
      throwInvalidIPv6Address(ipv6);
    }
    sections.push(value);
    if (index === length) {
      break;
    }
    code = ipv6.charCodeAt(index);
    if (code === CHAR_CODE_PERCENT) {
      if (index + 1 === length) {
        throwInvalidIPv6Address(ipv6);
      }
      hasZoneId = true;
      break;
    }
    if (code !== CHAR_CODE_COLON) {
      throwInvalidIPv6Address(ipv6);
    }
    if (index + 1 < length && ipv6.charCodeAt(index + 1) === CHAR_CODE_COLON) {
      if (compressAt !== -1) {
        throwInvalidIPv6Address(ipv6);
      }
      compressAt = sections.length;
      index += 2;
      continue;
    }
    index++;
    if (index === length) {
      throwInvalidIPv6Address(ipv6);
    }
  }
  if (compressAt === -1 ? sections.length !== 8 : sections.length >= 8) {
    throwInvalidIPv6Address(ipv6);
  }
  let result = 0n;
  const zeros = compressAt === -1 ? 0 : 8 - sections.length;
  const firstSectionEnd = compressAt === -1 ? sections.length : compressAt;
  for (let i = 0; i < firstSectionEnd; i++) {
    result <<= 16n;
    result += BigInt(sections[i]);
  }
  for (let i = 0; i < zeros; i++) {
    result <<= 16n;
  }
  for (let i = firstSectionEnd; i < sections.length; i++) {
    result <<= 16n;
    result += BigInt(sections[i]);
  }
  if (hasZoneId && !isIPv6LinkLocal(result)) {
    throwInvalidIPv6Address(ipv6);
  }
  return result;
};
var convertIPv4BinaryToString = (ipV4) => {
  const sections = [];
  for (let i = 0; i < 4; i++) {
    sections.push(ipV4 >> BigInt(8 * (3 - i)) & 0xffn);
  }
  return sections.join(".");
};
var isIPv4MappedIPv6 = (ipv6binary) => ipv6binary >> 32n === 0xffffn;
var convertIPv4MappedIPv6ToIPv4 = (ipv6binary) => ipv6binary & 0xffffffffn;
var convertIPv6BinaryToString = (ipV6) => {
  if (ipV6 === 0n) {
    return "::";
  }
  if (isIPv4MappedIPv6(ipV6)) {
    return `::ffff:${convertIPv4BinaryToString(convertIPv4MappedIPv6ToIPv4(ipV6))}`;
  }
  const sections = [];
  for (let i = 0; i < 8; i++) {
    sections.push((ipV6 >> BigInt(16 * (7 - i)) & 0xffffn).toString(16));
  }
  let currentZeroStart = -1;
  let maxZeroStart = -1;
  let maxZeroEnd = -1;
  for (let i = 0; i < 8; i++) {
    if (sections[i] === "0") {
      if (currentZeroStart === -1) {
        currentZeroStart = i;
      }
    } else {
      if (currentZeroStart > -1) {
        if (i - currentZeroStart > maxZeroEnd - maxZeroStart) {
          maxZeroStart = currentZeroStart;
          maxZeroEnd = i;
        }
        currentZeroStart = -1;
      }
    }
  }
  if (currentZeroStart > -1) {
    if (8 - currentZeroStart > maxZeroEnd - maxZeroStart) {
      maxZeroStart = currentZeroStart;
      maxZeroEnd = 8;
    }
  }
  if (maxZeroStart !== -1 && maxZeroEnd - maxZeroStart > 1) {
    sections.splice(maxZeroStart, maxZeroEnd - maxZeroStart, ":");
  }
  return sections.join(":").replace(/:{2,}/g, "::");
};
export {
  INVALID_IP_ADDRESS_ERROR_CODE,
  convertIPv4BinaryToString,
  convertIPv4MappedIPv6ToIPv4,
  convertIPv4ToBinary,
  convertIPv6BinaryToString,
  convertIPv6ToBinary,
  distinctRemoteAddr,
  expandIPv6,
  isIPv4MappedIPv6
};
