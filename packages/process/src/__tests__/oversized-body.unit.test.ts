/**
 * A body over a route's cap is refused with a 413 the client can read, never a reset.
 * @see modules/stored-object/specs/uploads-through-langwatch.feature
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import net, { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  startLivenessThread,
  type LingeringClose,
  type LivenessThread,
} from "../lifecycle/liveness-thread.ts";
import { Server } from "../server.ts";

/** The OTLP trace route's cap. */
const CAP_BYTES = 64 * 1024 * 1024;
/** Far enough over the cap that no socket buffer absorbs the rest of the body. */
const OVERSIZED_BYTES = 80 * 1024 * 1024;
const CHUNK = Buffer.alloc(1024 * 1024, 120);
const { logger } = createTestLogger();
const servers: Server[] = [];
const threads: LivenessThread[] = [];
const listeners: http.Server[] = [];
let scratch: string;
let oversizedFile: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "oversized-body-"));
  oversizedFile = join(scratch, "body.bin");
  await writeFile(oversizedFile, "");
  await truncate(oversizedFile, OVERSIZED_BYTES);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const listener of listeners.splice(0)) {
    listener.closeAllConnections();
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
});

/** Refuses a declared length over the cap before reading a byte, as the REST body limit does. */
function refuseOversized(request: IncomingMessage, response: ServerResponse): void {
  if (Number(request.headers["content-length"] ?? 0) > CAP_BYTES) {
    response.writeHead(413, { "Content-Type": "text/plain" }).end("Request body too large");
    return;
  }
  request.resume();
  request.on("end", () => response.end("ok"));
}

/** A booted api: its listener on loopback, its liveness thread on the public port. */
async function apiBehindItsThread(): Promise<number> {
  const server = Server.create({ name: "test-api", logger, ownsProcess: false });
  servers.push(server);
  await server.openLiveness();
  await server.serve({
    name: "api",
    start: () => undefined,
    stop: () => undefined,
    handler: refuseOversized,
  });
  return (server.healthAddress as AddressInfo).port;
}

/** A door in front of an api that refuses at once: how many body bytes the api was handed. */
async function doorBeforeRefusingApi(linger?: LingeringClose) {
  const api = http.createServer(refuseOversized);
  listeners.push(api);
  let apiBytesRead = 0;
  api.on("connection", (socket) => socket.on("close", () => (apiBytesRead += socket.bytesRead)));
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
  const door = await startLivenessThread({
    port: 0,
    heartbeat: new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer,
    proxyPort: (api.address() as AddressInfo).port,
    logger,
    requestTimeoutMs: 2 * 60 * 60_000,
    ...(linger === undefined ? {} : { linger }),
  });
  threads.push(door);
  return { port: door.address.port, apiBytesRead: () => apiBytesRead };
}

type Trickle = Readonly<{ statusLine: string; sent: number; closedAfterMs: number }>;

/** Declares `declared` bytes, sends `bytes` of them `chunkBytes` every `gapMs`, then waits. */
function trickle({
  port,
  declared,
  bytes,
  chunkBytes,
  gapMs,
}: {
  port: number;
  declared: number;
  bytes: number;
  chunkBytes: number;
  gapMs: number;
}): Promise<Trickle> {
  return new Promise((resolve) => {
    const started = Date.now();
    // Half-open, as a client still sending after the door's FIN: only the door's close ends it.
    const socket = net.connect({ port, host: "127.0.0.1", allowHalfOpen: true });
    let answer = "";
    let sent = 0;
    const pacing = setInterval(() => {
      if (sent >= bytes || socket.destroyed) return;
      socket.write(CHUNK.subarray(0, chunkBytes));
      sent += chunkBytes;
    }, gapMs);
    socket.on("connect", () =>
      socket.write(
        `POST /api/otel/v1/traces HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${declared}\r\n\r\n`,
      ),
    );
    socket.on("data", (chunk) => {
      answer += chunk.toString("latin1");
    });
    socket.on("error", () => undefined);
    socket.on("close", () => {
      clearInterval(pacing);
      resolve({
        statusLine: answer.split("\r\n")[0] ?? "",
        sent,
        closedAfterMs: Date.now() - started,
      });
    });
  });
}

type BodySink = Readonly<{
  write: (chunk: Buffer) => boolean;
  once: (event: "drain", listener: () => void) => unknown;
  destroyed: boolean;
}>;

/** Writes `bytes` of body into `sink`, waiting on each drain as a well-behaved client does. */
async function writeWholeBody({ sink, bytes }: { sink: BodySink; bytes: number }): Promise<void> {
  for (let sent = 0; sent < bytes && !sink.destroyed; sent += CHUNK.byteLength) {
    const size = Math.min(CHUNK.byteLength, bytes - sent);
    const flushed = sink.write(CHUNK.subarray(0, size));
    if (!flushed) await new Promise<void>((drained) => sink.once("drain", drained));
  }
}

/** Writes the request head and the whole body, then reads the answer, or names the error. */
function sendWholeBodyThenRead({ port, bytes }: { port: number; bytes: number }): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    let answer = "";
    let failed: string | undefined;
    socket.on("data", (chunk) => {
      answer += chunk.toString("latin1");
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      failed ??= error.code ?? error.message;
    });
    socket.on("close", () => resolve(answer.split("\r\n")[0] || `no answer (${failed})`));
    socket.pause();
    socket.on("connect", async () => {
      socket.write(
        `POST /api/otel/v1/traces HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${bytes}\r\n\r\n`,
      );
      await writeWholeBody({ sink: socket, bytes });
      socket.resume();
    });
  });
}

/** Node's own HTTP client sending the whole body: the status it read, or the error it got. */
function postWithNode({ port, bytes }: { port: number; bytes: number }): Promise<string> {
  return new Promise((resolve) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/api/otel/v1/traces",
      headers: { "Content-Length": String(bytes), "Content-Type": "application/x-protobuf" },
      agent: false,
    });
    request.on("response", (response) => {
      response.resume();
      resolve(String(response.statusCode));
    });
    request.on("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    void writeWholeBody({ sink: request, bytes }).then(() => request.end());
  });
}

/** curl uploading a file, `Expect` off as OTLP exporters send: the status it printed. */
async function postWithCurl({ port, file }: { port: number; file: string }): Promise<string> {
  const run = promisify(execFile);
  const { stdout } = await run(
    "curl",
    [
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_code}",
      "-H",
      "Expect:",
      "-H",
      "Content-Type: application/x-protobuf",
      "--data-binary",
      `@${file}`,
      `http://127.0.0.1:${port}/api/otel/v1/traces`,
    ],
    { timeout: 30_000 },
  ).catch((error: { stdout?: string; stderr?: string }) => ({
    stdout: `${error.stdout ?? ""} ${error.stderr ?? ""}`.trim(),
  }));
  return stdout;
}

describe("given the api behind its liveness thread, as a booted api runs", () => {
  describe("when a client sends a body far over the route's cap", () => {
    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("answers 413 to a client that writes the whole body before reading", async () => {
      const port = await apiBehindItsThread();

      const answer = await sendWholeBodyThenRead({ port, bytes: OVERSIZED_BYTES });

      expect(answer).toBe("HTTP/1.1 413 Payload Too Large");
    });

    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("answers 413 to Node's HTTP client", async () => {
      const port = await apiBehindItsThread();

      expect(await postWithNode({ port, bytes: OVERSIZED_BYTES })).toBe("413");
    });

    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("answers 413 to curl uploading a file", async () => {
      const port = await apiBehindItsThread();

      expect(await postWithCurl({ port, file: oversizedFile })).toBe("413");
    });
  });
});

describe("given a door that answered 413 while the body is still arriving", () => {
  describe("when the client goes on sending the whole body", () => {
    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("drops the rest itself and never forwards it to the api", async () => {
      const door = await doorBeforeRefusingApi();

      const answer = await sendWholeBodyThenRead({ port: door.port, bytes: OVERSIZED_BYTES });

      expect(answer).toBe("HTTP/1.1 413 Payload Too Large");
      expect(door.apiBytesRead()).toBeLessThan(OVERSIZED_BYTES / 2);
    });
  });

  describe("when the client goes quiet for longer than the idle budget", () => {
    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("closes it after the quiet spell, not at the hard cap", async () => {
      const door = await doorBeforeRefusingApi({ idleMs: 200, maxMs: 10_000, maxBytes: 1024 ** 3 });

      // A byte every 600 ms: the first lands on the closed socket, which is how the client learns.
      const answer = await trickle({
        port: door.port,
        declared: OVERSIZED_BYTES,
        bytes: OVERSIZED_BYTES,
        chunkBytes: 1,
        gapMs: 600,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 413 Payload Too Large");
      expect(answer.closedAfterMs).toBeLessThan(5_000);
    });

    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("keeps it open while each byte arrives within the quiet spell", async () => {
      const door = await doorBeforeRefusingApi({ idleMs: 300, maxMs: 1_500, maxBytes: 1024 ** 3 });

      const answer = await trickle({
        port: door.port,
        declared: OVERSIZED_BYTES,
        bytes: OVERSIZED_BYTES,
        chunkBytes: 1,
        gapMs: 100,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 413 Payload Too Large");
      expect(answer.closedAfterMs).toBeGreaterThanOrEqual(1_500);
    });
  });

  describe("when the client keeps trickling bytes without end", () => {
    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("closes it at the hard cap", async () => {
      const door = await doorBeforeRefusingApi({ idleMs: 5_000, maxMs: 400, maxBytes: 1024 ** 3 });

      const answer = await trickle({
        port: door.port,
        declared: OVERSIZED_BYTES,
        bytes: OVERSIZED_BYTES,
        chunkBytes: 1024,
        gapMs: 20,
      });

      expect(answer.statusLine).toBe("HTTP/1.1 413 Payload Too Large");
      expect(answer.closedAfterMs).toBeGreaterThanOrEqual(400);
      expect(answer.closedAfterMs).toBeLessThan(5_000);
    });
  });

  describe("when the client sends more than the byte budget", () => {
    /** @scenario "A body over the cap is answered 413, never a reset" */
    it("closes it before the whole body is read", async () => {
      const door = await doorBeforeRefusingApi({
        idleMs: 5_000,
        maxMs: 30_000,
        maxBytes: 2 * 1024 * 1024,
      });

      const answer = await trickle({
        port: door.port,
        declared: OVERSIZED_BYTES,
        bytes: OVERSIZED_BYTES,
        chunkBytes: CHUNK.byteLength,
        gapMs: 5,
      });

      expect(answer.sent).toBeGreaterThanOrEqual(2 * 1024 * 1024);
      expect(answer.sent).toBeLessThan(OVERSIZED_BYTES);
    });
  });
});
