var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var cache_exports = {};
__export(cache_exports, {
  cache: () => cache
});
module.exports = __toCommonJS(cache_exports);
var import_request = require("../../request");
var import_crypto = require("../../utils/crypto");
const defaultCacheableStatusCodes = [200];
const defaultMaxQueryBodySize = 64 * 1024;
const cacheKeyPath = "/.hono/cache";
const cacheKeyParameter = "__hono_cache_key";
const cacheMethodKeyParameter = "__hono_cache_method";
const queryDigestKeyParameter = "__hono_query_digest";
const cacheVaryKeyParameter = "__hono_cache_vary";
const queryRepresentationMetadataHeaders = [
  "content-type",
  "content-encoding",
  "content-language",
  "content-location"
];
const shouldSkipCacheControl = (cacheControl) => !!cacheControl && /(?:^|,\s*)(?:private|no-(?:store|cache))(?:\s*(?:=|,|$))/i.test(cacheControl);
const parseVaryDirectives = (vary) => {
  if (vary == null) {
    return [];
  }
  return (Array.isArray(vary) ? vary : vary.split(",")).map((directive) => directive.trim().toLowerCase()).filter(Boolean);
};
const createCacheKey = (key, requestUrl, request, varyHeaders) => {
  const url = new URL(cacheKeyPath, requestUrl);
  url.searchParams.append(cacheKeyParameter, key.split("#", 1)[0]);
  url.searchParams.append(cacheMethodKeyParameter, request.method);
  if (request.method === "QUERY") {
    url.searchParams.append(queryDigestKeyParameter, request.digest);
  }
  for (const header of varyHeaders) {
    url.searchParams.append(cacheVaryKeyParameter, JSON.stringify(header));
  }
  return url.href;
};
const shouldSkipCache = (res, optionsVaryDirectives, responseVary) => responseVary.length && (!optionsVaryDirectives || responseVary.some((name) => !optionsVaryDirectives.has(name))) || shouldSkipCacheControl(res.headers.get("Cache-Control")) || res.headers.has("Set-Cookie");
const reportCacheNotAvailable = (onCacheNotAvailable, reason) => {
  if (onCacheNotAvailable === false) {
  } else if (onCacheNotAvailable) {
    onCacheNotAvailable(reason);
  } else {
    console.log(reason);
  }
};
const createQueryDigest = async (c, maxQueryBodySize) => {
  if (!globalThis.crypto?.subtle) {
    return void 0;
  }
  if (c.req.raw.bodyUsed && Object.keys(c.req.bodyCache)[0] === "formData") {
    return void 0;
  }
  try {
    const requestHeaders = c.req.raw.headers;
    const metadata = new TextEncoder().encode(
      JSON.stringify(
        queryRepresentationMetadataHeaders.map((header) => [header, requestHeaders.get(header)])
      )
    );
    const body = (await (0, import_request.cloneRawRequest)(c.req)).body;
    const chunks = [];
    let bodySize = 0;
    if (body) {
      const reader = body.getReader();
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bodySize += value.byteLength;
        if (bodySize > maxQueryBodySize) {
          void reader.cancel().catch(() => {
          });
          return void 0;
        }
        chunks.push(value);
      }
    }
    const data = new Uint8Array(metadata.byteLength + bodySize);
    data.set(metadata);
    let offset = metadata.byteLength;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return await (0, import_crypto.sha256)(data) ?? void 0;
  } catch {
    return void 0;
  }
};
const cache = (options) => {
  if (!globalThis.caches) {
    reportCacheNotAvailable(
      options.onCacheNotAvailable,
      "Cache Middleware is not enabled because caches is not defined."
    );
    return async (_c, next) => await next();
  }
  if (!globalThis.crypto?.subtle) {
    reportCacheNotAvailable(
      options.onCacheNotAvailable,
      "Cache Middleware cannot cache QUERY requests because Web Crypto is not available."
    );
  }
  if (options.wait === void 0) {
    options.wait = false;
  }
  const cacheControlDirectives = options.cacheControl?.split(",").map((directive) => directive.toLowerCase());
  const optionsVaryList = parseVaryDirectives(options.vary);
  const varyDirectives = optionsVaryList.length ? new Set(optionsVaryList) : void 0;
  if (varyDirectives?.has("*")) {
    throw new Error(
      'Middleware vary configuration cannot include "*", as it disallows effective caching.'
    );
  }
  const cacheableStatusCodes = new Set(
    options.cacheableStatusCodes ?? defaultCacheableStatusCodes
  );
  const maxQueryBodySize = options.maxQueryBodySize ?? defaultMaxQueryBodySize;
  const addHeader = (c, responseVary) => {
    if (cacheControlDirectives) {
      const existingDirectives = c.res.headers.get("Cache-Control")?.split(",").map((d) => d.trim().split("=", 1)[0].toLowerCase()) ?? [];
      for (const directive of cacheControlDirectives) {
        let [name, value] = directive.trim().split("=", 2);
        name = name.toLowerCase();
        if (!existingDirectives.includes(name)) {
          c.header("Cache-Control", `${name}${value ? `=${value}` : ""}`, { append: true });
        }
      }
    }
    if (varyDirectives) {
      if (responseVary.length === 0) {
        c.header("Vary", Array.from(varyDirectives).join(", "));
      } else {
        const merged = new Set(varyDirectives);
        for (const directive of responseVary) {
          merged.add(directive);
        }
        if (merged.has("*")) {
          c.header("Vary", "*");
        } else {
          c.header("Vary", Array.from(merged).join(", "));
        }
      }
    }
  };
  return async function cache2(c, next) {
    if (c.req.method !== "GET" && c.req.method !== "QUERY" || c.req.raw.headers.has("Authorization")) {
      await next();
      return;
    }
    let cacheKeyRequest = { method: "GET" };
    if (c.req.method === "QUERY") {
      const digest = await createQueryDigest(c, maxQueryBodySize);
      if (digest === void 0) {
        await next();
        return;
      }
      cacheKeyRequest = { method: "QUERY", digest };
    }
    let key = c.req.url;
    if (options.keyGenerator) {
      key = await options.keyGenerator(c);
    }
    const varyHeaders = [];
    if (varyDirectives) {
      for (const directive of varyDirectives) {
        const value = c.req.raw.headers.get(directive) ?? "";
        varyHeaders.push([directive, value]);
      }
    }
    key = createCacheKey(key, c.req.url, cacheKeyRequest, varyHeaders);
    const cacheName = typeof options.cacheName === "function" ? await options.cacheName(c) : options.cacheName;
    const cache3 = await caches.open(cacheName);
    const response = await cache3.match(key);
    if (response) {
      return new Response(response.body, response);
    }
    await next();
    if (!cacheableStatusCodes.has(c.res.status)) {
      return;
    }
    const responseVary = parseVaryDirectives(c.res.headers.get("Vary"));
    addHeader(c, responseVary);
    if (shouldSkipCache(c.res, varyDirectives, responseVary)) {
      return;
    }
    const res = c.res.clone();
    if (options.wait) {
      await cache3.put(key, res);
    } else {
      c.executionCtx.waitUntil(cache3.put(key, res));
    }
  };
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cache
});
