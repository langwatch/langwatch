// src/middleware/compress/index.ts
import { parseAccept } from "../../utils/accept.js";
import { COMPRESSIBLE_CONTENT_TYPE_REGEX } from "../../utils/compress.js";
var ENCODING_TYPES = ["gzip", "deflate"];
var cacheControlNoTransformRegExp = /(?:^|,)\s*?no-transform\s*?(?:,|$)/i;
var selectEncoding = (header, candidates) => {
  if (header === void 0) {
    return void 0;
  }
  const accepts = parseAccept(header);
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
var varyAcceptEncodingRegExp = /(?:^|,)\s*accept-encoding\s*(?:,|$)/i;
var compress = (options) => {
  const threshold = options?.threshold ?? 1024;
  const candidates = options?.encoding ? [options.encoding] : ENCODING_TYPES;
  const contentTypeFilter = options?.contentTypeFilter ?? COMPRESSIBLE_CONTENT_TYPE_REGEX;
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
var shouldTransform = (res) => {
  const cacheControl = res.headers.get("Cache-Control");
  return !cacheControl || !cacheControlNoTransformRegExp.test(cacheControl);
};
export {
  COMPRESSIBLE_CONTENT_TYPE_REGEX,
  compress
};
