/**
 * The local auth proxy of a dev tunnel session: an ephemeral-port HTTP server
 * the tunnel points at, so only requests carrying the session secret reach
 * the local agent.
 */

import * as crypto from "node:crypto";
import * as http from "node:http";
import * as https from "node:https";
import chalk from "chalk";
import { DEV_SECRET_HEADER } from "./write-back";

/**
 * Hop-by-hop headers describe one connection, not the request, so forwarding
 * them corrupts the upstream connection (RFC 9110 section 7.6.1).
 */
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

/**
 * How long the local agent has to answer a forwarded request. Without it, an
 * agent that accepts the connection and never answers holds the proxy socket
 * for the whole session.
 */
const UPSTREAM_TIMEOUT_MS = 120_000;

/**
 * Constant-time comparison: the secret gates a public tunnel into the user's
 * local agent, so its check must not leak a prefix through timing. The length
 * check comes first because `timingSafeEqual` throws on a length mismatch.
 */
function secretMatches(presented: string | string[] | undefined, secret: string): boolean {
  if (typeof presented !== "string") return false;
  const presentedBuffer = Buffer.from(presented);
  const secretBuffer = Buffer.from(secret);
  return (
    presentedBuffer.length === secretBuffer.length &&
    crypto.timingSafeEqual(presentedBuffer, secretBuffer)
  );
}

export interface AuthProxy {
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * The path a forwarded request uses on the local server. The platform posts
 * the agent's real path (the write-back keeps it on the tunnel URL), so a
 * non-root incoming path is forwarded verbatim; a bare request falls back to
 * the target URL's own path (`--url` with a path).
 */
function joinProxyPath(targetPath: string, incoming: string): string {
  if (incoming === "/" || incoming === "") {
    const base = targetPath.replace(/\/+$/, "");
    return base === "" ? "/" : base;
  }
  return incoming.startsWith("/") ? incoming : `/${incoming}`;
}

/**
 * The local auth proxy: an ephemeral-port HTTP server that forwards every
 * request to the target local URL and rejects requests that do not carry the
 * session secret in the dev-secret header with 401. The tunnel points at this
 * proxy, so only the platform (which got the secret via the agent config)
 * can reach the local agent through the public URL.
 *
 * `upstreamTimeoutMs` is injectable for tests; sessions use the default.
 */
export function startAuthProxy({
  targetUrl,
  secret,
  upstreamTimeoutMs = UPSTREAM_TIMEOUT_MS,
}: {
  targetUrl: string;
  secret: string;
  upstreamTimeoutMs?: number;
}): Promise<AuthProxy> {
  const target = new URL(targetUrl);

  const server = http.createServer((req, res) => {
    if (!isAuthorized(req, secret)) {
      rejectUnauthorized(res);
      return;
    }
    forwardToUpstream({ req, res, target, targetUrl, upstreamTimeoutMs });
  });

  return listenOnEphemeralPort(server);
}

/** True when the request carries the session secret in the dev-secret header. */
function isAuthorized(req: http.IncomingMessage, secret: string): boolean {
  return secretMatches(req.headers[DEV_SECRET_HEADER.toLowerCase()], secret);
}

function rejectUnauthorized(res: http.ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error:
        "Missing or invalid dev tunnel secret. Requests must come through the LangWatch platform.",
    }),
  );
}

/**
 * Headers for the upstream call: the client's own, minus the ones that
 * describe the hop to this proxy rather than the request itself.
 */
function forwardableHeaders(req: http.IncomingMessage): http.IncomingHttpHeaders {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers[DEV_SECRET_HEADER.toLowerCase()];
  for (const name of HOP_BY_HOP_HEADERS) {
    delete headers[name];
  }
  return headers;
}

function forwardToUpstream({
  req,
  res,
  target,
  targetUrl,
  upstreamTimeoutMs,
}: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  target: URL;
  targetUrl: string;
  upstreamTimeoutMs: number;
}): void {
  const requestFn = target.protocol === "https:" ? https.request : http.request;

  const upstream = requestFn(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: joinProxyPath(target.pathname, req.url ?? "/"),
      method: req.method,
      headers: forwardableHeaders(req),
      timeout: upstreamTimeoutMs,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      upstreamRes.on("error", () => {
        // The upstream died mid-response: cutting the client's socket is
        // what tells it the response is incomplete.
        res.destroy();
      });
    },
  );
  upstream.on("timeout", () => {
    upstream.destroy(new Error(`it did not answer within ${upstreamTimeoutMs / 1000} seconds`));
  });
  upstream.on("error", (error) => {
    // The detail goes to the terminal, where the developer who owns the URL
    // is watching. It must not go in the response: that body travels back
    // through the public tunnel to the caller, and the local URL can carry
    // basic-auth credentials (http://user:password@127.0.0.1:3000).
    console.error(chalk.red(`Could not reach the local agent at ${targetUrl}: ${error.message}`));
    if (res.headersSent) {
      // The upstream died mid-response. Appending an error body here would
      // corrupt a response the client is already parsing; ending the socket
      // is what tells the client the response is incomplete.
      res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Could not reach the local agent behind this tunnel.",
      }),
    );
  });
  req.pipe(upstream);
}

function listenOnEphemeralPort(server: http.Server): Promise<AuthProxy> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The auth proxy could not bind a local port"));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
