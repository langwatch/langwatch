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
var compress_exports = {};
__export(compress_exports, {
  COMPRESSIBLE_CONTENT_TYPE_REGEX: () => import_compress.COMPRESSIBLE_CONTENT_TYPE_REGEX,
  compress: () => compress
});
module.exports = __toCommonJS(compress_exports);
var import_accept = require("../../utils/accept");
var import_compress = require("../../utils/compress");
const ENCODING_TYPES = ["gzip", "deflate"];
const cacheControlNoTransformRegExp = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
const selectEncoding = (header, candidates) => {
  if (header === void 0) {
    return void 0;
  }
  const accepts = (0, import_accept.parseAccept)(header);
  const wildcardQ = accepts.find((a) => a.type === "*")?.q;
  let best;
  for (const enc of candidates) {
    const explicit = accepts.find((a) => a.type.toLowerCase() === enc);
    const q = explicit ? explicit.q : wildcardQ ?? 0;
    if (q === 1) {
      return enc;
    } else if (q > 0 && (!best || q > best.q)) {
      best = { encoding: enc, q };
    }
  }
  return best?.encoding;
};
const varyAcceptEncodingRegExp = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
const compress = (options) => {
  const threshold = options?.threshold ?? 1024;
  const candidates = options?.encoding ? [options.encoding] : ENCODING_TYPES;
  const contentTypeFilter = options?.contentTypeFilter ?? import_compress.COMPRESSIBLE_CONTENT_TYPE_REGEX;
  const shouldCompress = typeof contentTypeFilter === "function" ? (res) => {
    const type = res.headers.get("Content-Type");
    return type && contentTypeFilter(type);
  } : (res) => {
    const type = res.headers.get("Content-Type");
    return type && contentTypeFilter.test(type);
  };
  return async function compress2(ctx, next) {
    await next();
    const contentLength = ctx.res.headers.get("Content-Length");
    if (ctx.res.status === 206 || // partial content, Content-Range refers to the uncompressed bytes
    ctx.res.headers.has("Content-Encoding") || // already encoded
    ctx.res.headers.has("Transfer-Encoding") || // already encoded or chunked
    ctx.req.method === "HEAD" || // HEAD request
    contentLength && Number(contentLength) < threshold || // content-length below threshold
    !shouldCompress(ctx.res) || // not compressible type
    !shouldTransform(ctx.res)) {
      return;
    }
    const current = ctx.res.headers.get("Vary");
    if (current !== "*" && !(current && varyAcceptEncodingRegExp.test(current))) {
      ctx.header("Vary", current ? `${current}, Accept-Encoding` : "Accept-Encoding");
    }
    const accepted = ctx.req.header("Accept-Encoding");
    const encoding = selectEncoding(accepted, candidates);
    if (!encoding || !ctx.res.body) {
      return;
    }
    const stream = new CompressionStream(encoding);
    ctx.res = new Response(ctx.res.body.pipeThrough(stream), ctx.res);
    ctx.res.headers.delete("Content-Length");
    ctx.res.headers.set("Content-Encoding", encoding);
    const etag = ctx.res.headers.get("ETag");
    if (etag && !etag.startsWith("W/")) {
      ctx.res.headers.set("ETag", `W/${etag}`);
    }
  };
};
const shouldTransform = (res) => {
  const cacheControl = res.headers.get("Cache-Control");
  return !cacheControl || !cacheControlNoTransformRegExp.test(cacheControl);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  COMPRESSIBLE_CONTENT_TYPE_REGEX,
  compress
});
