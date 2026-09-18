// src/middleware/jwt/jwt.ts
import { getCookie, getSignedCookie } from "../../helper/cookie/index.js";
import { HTTPException } from "../../http-exception.js";
import { Jwt } from "../../utils/jwt/index.js";
import "../../context.js";
var jwt = (options) => {
  const verifyOpts = options.verification || {};
  if (!options || !options.secret) {
    throw new Error('JWT auth middleware requires options for "secret"');
  }
  if (!options.alg) {
    throw new Error('JWT auth middleware requires options for "alg"');
  }
  if (!crypto.subtle || !crypto.subtle.importKey) {
    throw new Error("`crypto.subtle.importKey` is undefined. JWT auth middleware requires it.");
  }
  return async function jwt2(ctx, next) {
    const headerName = options.headerName || "Authorization";
    const credentials = ctx.req.raw.headers.get(headerName);
    let token;
    if (credentials) {
      const parts = credentials.split(/\s+/);
      if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
        const errDescription = "invalid credentials structure";
        throw new HTTPException(401, {
          message: errDescription,
          res: unauthorizedResponse({
            ctx,
            error: "invalid_request",
            errDescription,
            realm: options.realm
          })
        });
      } else {
        token = parts[1];
      }
    } else if (options.cookie) {
      if (typeof options.cookie == "string") {
        token = getCookie(ctx, options.cookie);
      } else if (options.cookie.secret) {
        if (options.cookie.prefixOptions) {
          token = await getSignedCookie(
            ctx,
            options.cookie.secret,
            options.cookie.key,
            options.cookie.prefixOptions
          );
        } else {
          token = await getSignedCookie(ctx, options.cookie.secret, options.cookie.key);
        }
      } else {
        if (options.cookie.prefixOptions) {
          token = getCookie(ctx, options.cookie.key, options.cookie.prefixOptions);
        } else {
          token = getCookie(ctx, options.cookie.key);
        }
      }
    }
    if (!token) {
      const errDescription = "no authorization included in request";
      throw new HTTPException(401, {
        message: errDescription,
        res: unauthorizedResponse({
          ctx,
          error: "invalid_request",
          errDescription,
          realm: options.realm
        })
      });
    }
    let payload;
    let cause;
    try {
      payload = await Jwt.verify(token, options.secret, {
        alg: options.alg,
        ...verifyOpts
      });
    } catch (e) {
      cause = e;
    }
    if (!payload) {
      throw new HTTPException(401, {
        message: "Unauthorized",
        res: unauthorizedResponse({
          ctx,
          error: "invalid_token",
          statusText: "Unauthorized",
          errDescription: "token verification failure",
          realm: options.realm
        }),
        cause
      });
    }
    ctx.set("jwtPayload", payload);
    await next();
  };
};
function unauthorizedResponse(opts) {
  const realm = (opts.realm ?? opts.ctx.req.url).replace(/"/g, '\\"');
  const errDescription = opts.errDescription.replace(/"/g, '\\"');
  return new Response("Unauthorized", {
    status: 401,
    statusText: opts.statusText,
    headers: {
      "WWW-Authenticate": `Bearer realm="${realm}",error="${opts.error}",error_description="${errDescription}"`
    }
  });
}
var verifyWithJwks = Jwt.verifyWithJwks;
var verify = Jwt.verify;
var decode = Jwt.decode;
var sign = Jwt.sign;
export {
  decode,
  jwt,
  sign,
  verify,
  verifyWithJwks
};
