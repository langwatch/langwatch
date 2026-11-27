/**
 * The public listeners' timeouts: a long body allowance only where a route declares one.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import diagnostics from "node:diagnostics_channel";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_LISTENER_TIMEOUTS,
  startLivenessThread,
  type LivenessThread,
} from "../lifecycle/liveness-thread.ts";
import { Server } from "../server.ts";

/** 5 GiB in two hours is about 6 Mbit/s: the slowest upload link the api still serves. */
const TWO_HOURS_MS = 2 * 60 * 60_000;
/** Node's own `requestTimeout` default. */
const NODE_REQUEST_TIMEOUT_MS = 300_000;
/** As the stored-object contract declares it; a framework test does not import a module. */
const UPLOAD_ROUTE = /^\/api\/stored-objects\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]*\/content$/;
/** A route given its own allowance, shorter than the upload route's. */
const IMPORT_ROUTE = /^\/api\/imports$/;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const servers: Server[] = [];
const threads: LivenessThread[] = [];
const listeners: http.Server[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

/** The http.Server that answered one request, as Node itself reports it. */
async function listenerAnswering(url: string): Promise<http.Server> {
  const channel = diagnostics.channel("http.server.request.start");
  let seen: http.Server | undefined;
  const onRequest = (message: unknown): void => {
    seen = (message as { server: http.Server }).server;
  };
  channel.subscribe(onRequest);
  try {
    await (await fetch(url)).text();
  } finally {
    channel.unsubscribe(onRequest);
  }
  if (seen === undefined) throw new Error("no listener answered");
  return seen;
}

function portOf(server: Server): number {
  return (server.healthAddress as AddressInfo).port;
}

/** Answers with the byte count once the whole body arrived; an event stream stays open. */
async function application(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.url === "/api/events") {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(": open\n\n");
    return;
  }
  let bytes = 0;
  try {
    for await (const chunk of request) bytes += (chunk as Buffer).byteLength;
  } catch {
    return;
  }
  if (!response.headersSent) response.end(String(bytes));
}

/**
 * The api's listener with the upload route's long allowance and a short bound for the rest;
 * `behindThread` puts its liveness thread on the public port, as every booted process does.
 */
async function apiListener({
  requestBodyTimeoutMs,
  importTimeoutMs = TWO_HOURS_MS,
  behindThread = false,
}: {
  requestBodyTimeoutMs: number;
  importTimeoutMs?: number;
  behindThread?: boolean;
}) {
  const server = Server.create({
    name: "test-api",
    logger,
    ownsProcess: false,
    longRequestBodies: [
      { path: UPLOAD_ROUTE, timeoutMs: TWO_HOURS_MS },
      { path: IMPORT_ROUTE, timeoutMs: importTimeoutMs },
    ],
    requestBodyTimeoutMs,
  });
  servers.push(server);
  if (behindThread) await server.openLiveness();
  await server.serve({
    name: "api",
    start: () => undefined,
    stop: () => undefined,
    handler: (request: IncomingMessage, response: ServerResponse) => application(request, response),
  });
  return server;
}

type SlowAnswer = Readonly<{ statusLine: string; closedEarly: boolean; elapsedMs: number }>;

/**
 * Sends a body one byte every `gapMs`, and goes on sending after the server's FIN as a slow
 * client would: how the server answered, and whether it hung up before the body was sent.
 */
function sendSlowly({
  port,
  method = "POST",
  path,
  bytes,
  gapMs,
}: {
  port: number;
  method?: string;
  path: string;
  bytes: number;
  gapMs: number;
}): Promise<SlowAnswer> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let answer = "";
    let sent = 0;
    const finish = (closedEarly: boolean): void => {
      clearInterval(pacing);
      clearTimeout(giveUp);
      socket.destroy();
      resolve({
        statusLine: answer.split("\r\n")[0] ?? "",
        closedEarly,
        elapsedMs: Date.now() - started,
      });
    };
    const pacing = setInterval(() => {
      if (sent >= bytes || socket.destroyed) return;
      socket.write("x");
      sent += 1;
    }, gapMs);
    const giveUp = setTimeout(() => finish(false), bytes * gapMs + 1_000);
    socket.on("connect", () =>
      socket.write(
        `${method} ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${bytes}\r\n\r\n`,
      ),
    );
    socket.on("data", (chunk) => {
      answer += chunk.toString("latin1");
    });
    socket.on("error", () => undefined);
    socket.on("close", () => finish(sent < bytes));
  });
}

describe("the public HTTP listener", () => {
  describe("when the api's HTTP listener starts with the upload route's allowance", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("lets a request body take two hours and adds no idle socket timeout", async () => {
      const server = await apiListener({ requestBodyTimeoutMs: NODE_REQUEST_TIMEOUT_MS });

      const listener = await listenerAnswering(`http://localhost:${portOf(server)}/healthz`);

      expect(listener.requestTimeout).toBe(TWO_HOURS_MS);
      expect(listener.timeout).toBe(0);
      expect(listener.headersTimeout).toBe(PUBLIC_LISTENER_TIMEOUTS.headersTimeout);
      expect(listener.keepAliveTimeout).toBe(PUBLIC_LISTENER_TIMEOUTS.keepAliveTimeout);
    });
  });

  describe("when a listener starts with no long body allowance, as the worker's and tasks' do", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("keeps Node's five minutes for every request body", async () => {
      const server = Server.create({ name: "test-worker", logger, ownsProcess: false });
      servers.push(server);
      await server.listen();

      const listener = await listenerAnswering(`http://localhost:${portOf(server)}/healthz`);

      expect(listener.requestTimeout).toBe(NODE_REQUEST_TIMEOUT_MS);
      expect(listener.timeout).toBe(0);
    });
  });

  describe("when the liveness thread fronts a process with no long body allowance", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("keeps Node's five minutes and adds no idle socket timeout", async () => {
      const thread = await startLivenessThread({
        port: 0,
        heartbeat: new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer,
        proxyPort: 1,
        logger,
        requestTimeoutMs: NODE_REQUEST_TIMEOUT_MS,
      });
      threads.push(thread);

      expect(thread.listenerTimeouts).toEqual({
        requestTimeout: NODE_REQUEST_TIMEOUT_MS,
        headersTimeout: PUBLIC_LISTENER_TIMEOUTS.headersTimeout,
        keepAliveTimeout: PUBLIC_LISTENER_TIMEOUTS.keepAliveTimeout,
        timeout: 0,
      });
    });
  });
});

describe("given a client that sends its request body slowly to the api", () => {
  /** The short bound in place of Node's 300 s, so a test can outlast it. */
  const requestBodyTimeoutMs = 300;

  describe("when it sends to LangWatch's signed upload route", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("lets the body outlast the short bound and answers once it arrived", async () => {
      const server = await apiListener({ requestBodyTimeoutMs });

      const answer = await sendSlowly({
        port: portOf(server),
        method: "PUT",
        path: "/api/stored-objects/uploads/so_1/content?sig=abc",
        bytes: 8,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 200 OK");
      expect(answer.closedEarly).toBe(false);
      expect(answer.elapsedMs).toBeGreaterThan(requestBodyTimeoutMs);
    });
  });

  describe("when it sends to any other route", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("cuts the body at the short bound with Node's 408", async () => {
      const server = await apiListener({ requestBodyTimeoutMs });

      const answer = await sendSlowly({
        port: portOf(server),
        path: "/api/trpc/datasets.upsert",
        bytes: 8,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 408 Request Timeout");
      expect(answer.closedEarly).toBe(true);
      expect(answer.elapsedMs).toBeLessThan(8 * 100);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/trpc/datasets.upsert", timeoutMs: 300 }),
        "request body took longer than its route allows",
      );
    });
  });

  describe("when a route has its own allowance, shorter than the upload route's", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("cuts the body at that route's allowance and names it", async () => {
      const server = await apiListener({ requestBodyTimeoutMs: 100, importTimeoutMs: 400 });

      const answer = await sendSlowly({
        port: portOf(server),
        path: "/api/imports",
        bytes: 10,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 408 Request Timeout");
      expect(answer.elapsedMs).toBeGreaterThanOrEqual(400);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/imports", timeoutMs: 400 }),
        "request body took longer than its route allows",
      );
    });
  });

  describe.each([
    "/api/stored-objects/uploads/../../trpc/content",
    "/api/stored-objects/uploads/../content",
    "/api/stored-objects/uploads/./content",
    "/api/stored-objects/uploads/%2e%2e/content",
  ])("when %s only reaches another route through a dot segment", (path) => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("holds it to the short bound", async () => {
      const server = await apiListener({ requestBodyTimeoutMs });

      const answer = await sendSlowly({ port: portOf(server), path, bytes: 8, gapMs: 100 });

      expect(answer.statusLine).toBe("HTTP/1.1 408 Request Timeout");
      expect(answer.closedEarly).toBe(true);
    });
  });

  describe("when a quiet event stream stays open past the short bound", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("keeps the stream open", async () => {
      const server = await apiListener({ requestBodyTimeoutMs: 100 });
      const response = await fetch(`http://localhost:${portOf(server)}/api/events`);
      const reader = response.body?.getReader();
      await reader?.read();

      const next = reader?.read();
      const outcome = await Promise.race([
        next?.then(({ done }) => (done ? "closed" : "data")),
        new Promise((resolve) => setTimeout(() => resolve("still open"), 400)),
      ]);

      expect(outcome).toBe("still open");
      await reader?.cancel();
    });
  });
});

describe("given the api behind its liveness thread, as a booted api runs", () => {
  const requestBodyTimeoutMs = 300;

  describe("when a client sends its body slowly to LangWatch's signed upload route", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    it("lets the body outlast the short bound through the thread", async () => {
      const server = await apiListener({ requestBodyTimeoutMs, behindThread: true });

      const answer = await sendSlowly({
        port: portOf(server),
        method: "PUT",
        path: "/api/stored-objects/uploads/so_1/content?sig=abc",
        bytes: 8,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 200 OK");
      expect(answer.closedEarly).toBe(false);
    });
  });

  describe("when a client sends its body slowly to any other route", () => {
    /** @scenario "The api allows a body up to two hours on the upload route only" */
    /** @scenario "A door in front of the api closes a client whose body the api cut" */
    it("cuts it at the short bound and the thread closes the client", async () => {
      const server = await apiListener({ requestBodyTimeoutMs, behindThread: true });

      const answer = await sendSlowly({
        port: portOf(server),
        path: "/api/trpc/datasets.upsert",
        bytes: 8,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 408 Request Timeout");
      expect(answer.closedEarly).toBe(true);
    });
  });
});

describe("given a proxy door in front of the api", () => {
  describe("when the api answers before the client's body has fully arrived", () => {
    /** @scenario "A door in front of the api closes a client whose body the api cut" */
    it("relays the answer and closes the client's connection", async () => {
      const api = http.createServer((_request, response) => {
        response.writeHead(408, { Connection: "close" }).end();
      });
      listeners.push(api);
      await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
      const door = await startLivenessThread({
        port: 0,
        heartbeat: new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer,
        proxyPort: (api.address() as AddressInfo).port,
        logger,
        requestTimeoutMs: TWO_HOURS_MS,
      });
      threads.push(door);

      const answer = await sendSlowly({
        port: door.address.port,
        path: "/api/trpc/datasets.upsert",
        bytes: 8,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 408 Request Timeout");
      expect(answer.closedEarly).toBe(true);
    });
  });
});

describe("given the liveness thread holding the api's two-hour ceiling", () => {
  /** A thread in front of a listener that answers everything at once, readiness latched. */
  async function threadWithItsOwnAnswers(): Promise<LivenessThread> {
    const api = http.createServer((_request, response) => response.end("ok"));
    listeners.push(api);
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    const readiness = new SharedArrayBuffer(4);
    Atomics.store(new Int32Array(readiness), 0, 1);
    const thread = await startLivenessThread({
      port: 0,
      heartbeat: new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer,
      readiness,
      proxyPort: (api.address() as AddressInfo).port,
      logger,
      requestTimeoutMs: TWO_HOURS_MS,
      // Shorter than the slow body, so the close comes from the lingering budget.
      linger: { idleMs: 5_000, maxMs: 300, maxBytes: 1024 },
    });
    threads.push(thread);
    return thread;
  }

  describe.each(["/healthz", "/readyz"])(
    "when a client sends a slow body to %s, which the thread answers itself",
    (path) => {
      /** @scenario "A door in front of the api closes a client whose body the api cut" */
      it("answers and closes the connection instead of holding it for the ceiling", async () => {
        const thread = await threadWithItsOwnAnswers();

        const answer = await sendSlowly({ port: thread.address.port, path, bytes: 8, gapMs: 100 });

        expect(answer.statusLine).toBe("HTTP/1.1 200 OK");
        expect(answer.closedEarly).toBe(true);
      });
    },
  );

  describe("when a probe sends no body", () => {
    /** @scenario "A door in front of the api closes a client whose body the api cut" */
    it("keeps the connection open for reuse", async () => {
      const thread = await threadWithItsOwnAnswers();

      const response = await fetch(`http://127.0.0.1:${thread.address.port}/healthz`);

      expect(response.status).toBe(200);
      expect(response.headers.get("connection")).not.toBe("close");
      await response.text();
    });
  });
});
