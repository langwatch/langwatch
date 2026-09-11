/**
 * The loopback proxy `langwatch ollama` puts in front of the Ollama server.
 * It is a forwarder first and an observer second: every request reaches the
 * server and every answer reaches the caller, byte for byte and chunk for
 * chunk, whether or not the exchange is one this build reports. Only the
 * three prompt-carrying routes are read (see ollama-trace.ts).
 */

import {
  createServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { OllamaSpanEmitter } from "./ollama-emitter";
import { buildOllamaSpan, ollamaRouteFor, type OllamaRoute } from "./ollama-trace";

/** Where Ollama listens when nothing says otherwise. */
export const DEFAULT_OLLAMA_ORIGIN = "http://127.0.0.1:11434";

const DEFAULT_OLLAMA_PORT = "11434";

/**
 * Read an `OLLAMA_HOST` the way Ollama does: a bare host, a host and port, or
 * a full URL. An unparseable value falls back to the default rather than
 * failing the launch — the server gets to complain about an address it does
 * not like, in its own words.
 */
export function resolveUpstreamOrigin(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_OLLAMA_ORIGIN;
  try {
    const written = value.includes("://");
    const url = new URL(written ? value : `http://${value}`);
    // A scheme-less `host` means the default Ollama port, not the HTTP one:
    // `OLLAMA_HOST=my-box` reaches my-box:11434.
    if (!written && !url.port) url.port = DEFAULT_OLLAMA_PORT;
    return url.origin;
  } catch {
    return DEFAULT_OLLAMA_ORIGIN;
  }
}

export interface OllamaCaptureProxy {
  /** The address to hand the child as `OLLAMA_HOST`. */
  url: string;
  /** Stop accepting connections and wait for the ones in flight. */
  close(): Promise<void>;
}

export interface OllamaCaptureProxyOptions {
  /** Origin of the real Ollama server, from `resolveUpstreamOrigin`. */
  upstreamOrigin: string;
  emitter: OllamaSpanEmitter;
  /** Clock seam, so a test can assert on span timings. */
  now?: () => number;
}

/** Everything a captured exchange accumulates while it is in flight. */
interface Capture {
  route: OllamaRoute;
  requestBody: Buffer;
  responseBody: Buffer[];
  startedAtMs: number;
}

/** The one upstream every request of this proxy is forwarded to. */
interface Upstream {
  origin: string;
  url: URL;
  send: typeof httpRequest;
  emitter: OllamaSpanEmitter;
  now: () => number;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Which prompt-carrying route this request is, if any. */
function routeOf(req: IncomingMessage): OllamaRoute | null {
  if (req.method !== "POST") return null;
  return ollamaRouteFor(new URL(req.url ?? "/", "http://proxy").pathname);
}

/**
 * The headers for the forwarded hop. A captured exchange asks for an
 * uncompressed answer, because a compressed one is unreadable to the tee; a
 * re-sent body carries the one length this hop knows, whatever framing the
 * caller used.
 */
function forwardHeaders(
  req: IncomingMessage,
  upstream: Upstream,
  capture: Capture | null,
  body: Buffer | null,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers[key] = value;
  }
  headers.host = upstream.url.host;
  if (capture) headers["accept-encoding"] = "identity";
  if (body) {
    delete headers["transfer-encoding"];
    headers["content-length"] = String(body.byteLength);
  }
  return headers;
}

/** Read the finished exchange and hand the emitter its span. */
function report(upstream: Upstream, capture: Capture, status: number): void {
  try {
    const span = buildOllamaSpan({
      route: capture.route,
      requestBody: capture.requestBody.toString("utf8"),
      responseBody: Buffer.concat(capture.responseBody).toString("utf8"),
      status,
      startedAtMs: capture.startedAtMs,
      endedAtMs: upstream.now(),
    });
    if (span) upstream.emitter.add(span);
  } catch {
    // A call that could not be read is still a call that worked; the session
    // must not notice that its span was lost.
    return;
  }
}

/** Pipe the upstream answer back, teeing it when the exchange is captured. */
function relayAnswer(
  upstream: Upstream,
  capture: Capture | null,
  proxyRes: IncomingMessage,
  res: ServerResponse,
): void {
  res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
  if (capture) {
    proxyRes.on("data", (chunk: Buffer) => capture.responseBody.push(chunk));
    proxyRes.on("end", () => report(upstream, capture, proxyRes.statusCode ?? 0));
  }
  proxyRes.pipe(res);
}

/** Answer the caller when the Ollama server could not be reached at all. */
function answerUnreachable(upstream: Upstream, res: ServerResponse, error: Error): void {
  if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: `langwatch could not reach the ollama server at ${upstream.origin}: ${error.message}`,
    }),
  );
}

function forward(
  upstream: Upstream,
  req: IncomingMessage,
  res: ServerResponse,
  capture: Capture | null,
  body: Buffer | null,
): void {
  const proxyReq: ClientRequest = upstream.send(
    {
      protocol: upstream.url.protocol,
      hostname: upstream.url.hostname,
      port: upstream.url.port,
      path: req.url ?? "/",
      method: req.method,
      headers: forwardHeaders(req, upstream, capture, body),
    },
    (proxyRes) => relayAnswer(upstream, capture, proxyRes, res),
  );

  proxyReq.on("error", (error: Error) => answerUnreachable(upstream, res, error));

  // The caller gave up (Ctrl-C mid-generation): stop the upstream work rather
  // than leaving the model running for an answer nobody reads.
  res.on("close", () => {
    if (!res.writableFinished) proxyReq.destroy();
  });

  if (body) {
    proxyReq.end(body);
  } else {
    req.pipe(proxyReq);
  }
}

function handle(upstream: Upstream, req: IncomingMessage, res: ServerResponse): void {
  const route = routeOf(req);
  if (!route) {
    forward(upstream, req, res, null, null);
    return;
  }
  // A prompt body is small and the span needs it whole, so it is buffered
  // before the hop; the answer is teed while it streams.
  void readBody(req)
    .then((body) => {
      const capture: Capture = {
        route,
        requestBody: body,
        responseBody: [],
        startedAtMs: upstream.now(),
      };
      forward(upstream, req, res, capture, body);
    })
    .catch(() => {
      if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "langwatch could not read the request body" }));
    });
}

export async function startOllamaCaptureProxy(
  options: OllamaCaptureProxyOptions,
): Promise<OllamaCaptureProxy> {
  const url = new URL(options.upstreamOrigin);
  const upstream: Upstream = {
    origin: options.upstreamOrigin,
    url,
    send: url.protocol === "https:" ? httpsRequest : httpRequest,
    emitter: options.emitter,
    now: options.now ?? (() => Date.now()),
  };

  const server = createServer((req, res) => handle(upstream, req, res));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    // Keep-alive sockets the child left open would hold the close open past
    // the command it belongs to; the child is gone by now, so drop them.
    server.closeIdleConnections?.();
    server.close(() => resolve());
  });
}
