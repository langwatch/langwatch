// src/middleware/ip-restriction/index.ts
import { HTTPException } from "../../http-exception.js";
import {
  convertIPv4MappedIPv6ToIPv4,
  convertIPv4ToBinary,
  convertIPv6BinaryToString,
  convertIPv6ToBinary,
  distinctRemoteAddr,
  isIPv4MappedIPv6,
  INVALID_IP_ADDRESS_ERROR_CODE
} from "../../utils/ipaddr.js";
var IS_CIDR_NOTATION_REGEX = /\/[^/]*$/;
var parseCidrPrefix = (rule, prefix, max) => {
  if (!/^[0-9]{1,3}$/.test(prefix)) {
    throw new TypeError(`Invalid rule: ${rule}`);
  }
  const parsedPrefix = parseInt(prefix);
  if (parsedPrefix > max) {
    throw new TypeError(`Invalid rule: ${rule}`);
  }
  return parsedPrefix;
};
var buildMatcher = (rules) => {
  const functionRules = [];
  const staticRules = /* @__PURE__ */ new Set();
  const staticIPv4Rules = /* @__PURE__ */ new Set();
  const staticIPv6Rules = /* @__PURE__ */ new Set();
  const cidrRules = [];
  const registerStaticRule = (rule) => {
    const type = distinctRemoteAddr(rule);
    if (type === void 0) {
      throw new TypeError(`Invalid rule: ${rule}`);
    }
    if (type === "IPv4") {
      const ipv4binary = convertIPv4ToBinary(rule);
      staticRules.add(rule);
      staticRules.add(`::ffff:${rule}`);
      staticIPv4Rules.add(ipv4binary);
      staticIPv6Rules.add(0xffffn << 32n | ipv4binary);
    } else {
      const ipv6binary = convertIPv6ToBinary(rule);
      const ipv6Addr = convertIPv6BinaryToString(ipv6binary);
      staticRules.add(ipv6Addr);
      staticIPv6Rules.add(ipv6binary);
      if (isIPv4MappedIPv6(ipv6binary)) {
        staticRules.add(ipv6Addr.substring(7));
        staticIPv4Rules.add(convertIPv4MappedIPv6ToIPv4(ipv6binary));
      }
    }
  };
  for (let rule of rules) {
    if (rule === "*") {
      return () => true;
    } else if (typeof rule === "function") {
      functionRules.push(rule);
    } else {
      if (IS_CIDR_NOTATION_REGEX.test(rule)) {
        const separatedRule = rule.split("/");
        const addrStr = separatedRule[0];
        const type = distinctRemoteAddr(addrStr);
        if (type === void 0) {
          throw new TypeError(`Invalid rule: ${rule}`);
        }
        let isIPv4 = type === "IPv4";
        let prefix = parseCidrPrefix(rule, separatedRule[1], isIPv4 ? 32 : 128);
        if (isIPv4 ? prefix === 32 : prefix === 128) {
          rule = addrStr;
        } else {
          let addr = (isIPv4 ? convertIPv4ToBinary : convertIPv6ToBinary)(addrStr);
          if (type === "IPv6" && isIPv4MappedIPv6(addr) && prefix >= 96) {
            isIPv4 = true;
            addr = convertIPv4MappedIPv6ToIPv4(addr);
            prefix -= 96;
          }
          const mask = (1n << BigInt(prefix)) - 1n << BigInt((isIPv4 ? 32 : 128) - prefix);
          cidrRules.push([isIPv4, addr & mask, mask]);
          continue;
        }
      }
      registerStaticRule(rule);
    }
  }
  return (remote) => {
    if (staticRules.has(remote.addr)) {
      return true;
    }
    const remoteAddr = remote.binaryAddr ||= (remote.isIPv4 ? convertIPv4ToBinary : convertIPv6ToBinary)(remote.addr);
    const remoteIPv4Addr = remote.isIPv4 || isIPv4MappedIPv6(remoteAddr) ? remote.isIPv4 ? remoteAddr : convertIPv4MappedIPv6ToIPv4(remoteAddr) : void 0;
    if ((remote.isIPv4 ? staticIPv4Rules : staticIPv6Rules).has(remoteAddr)) {
      return true;
    }
    for (const [isIPv4, addr, mask] of cidrRules) {
      if (isIPv4) {
        if (remoteIPv4Addr === void 0) {
          continue;
        }
        if ((remoteIPv4Addr & mask) === addr) {
          return true;
        }
        continue;
      }
      if (remote.isIPv4) {
        continue;
      }
      if ((remoteAddr & mask) === addr) {
        return true;
      }
    }
    for (const rule of functionRules) {
      if (rule({ addr: remote.addr, type: remote.type })) {
        return true;
      }
    }
    return false;
  };
};
var ipRestriction = (getIP, { denyList = [], allowList = [] }, onError) => {
  const allowLength = allowList.length;
  const denyMatcher = buildMatcher(denyList);
  const allowMatcher = buildMatcher(allowList);
  const blockError = (c) => new HTTPException(403, {
    res: c.text("Forbidden", {
      status: 403
    })
  });
  return async function ipRestriction2(c, next) {
    const connInfo = getIP(c);
    const addr = typeof connInfo === "string" ? connInfo : connInfo.remote.address;
    if (!addr) {
      throw blockError(c);
    }
    const type = typeof connInfo !== "string" && connInfo.remote.addressType || distinctRemoteAddr(addr);
    const remoteData = { addr, type, isIPv4: type === "IPv4" };
    try {
      if (denyMatcher(remoteData)) {
        if (onError) {
          return onError({ addr, type }, c);
        }
        throw blockError(c);
      }
      if (allowMatcher(remoteData)) {
        return await next();
      }
    } catch (e) {
      if (e instanceof TypeError && e.code === INVALID_IP_ADDRESS_ERROR_CODE) {
        throw blockError(c);
      }
      throw e;
    }
    if (allowLength === 0) {
      return await next();
    } else {
      if (onError) {
        return await onError({ addr, type }, c);
      }
      throw blockError(c);
    }
  };
};
export {
  ipRestriction
};
