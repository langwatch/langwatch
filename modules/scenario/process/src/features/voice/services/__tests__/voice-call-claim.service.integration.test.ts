// Spike: a pod that receives the Twilio media upgrade spawns the child AFTER the upgrade
// arrives (no pre-spawned child, no tunnel). Spawn latency is the risk being measured.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";

import {
  InMemoryPendingVoiceCallStore,
  VOICE_CLAIM_HANDSHAKE_BUDGET_MS,
  VoiceCallClaimService,
} from "../voice-call-claim.service.ts";

const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/voice-echo-child.ts", import.meta.url));
const TEST_TIMEOUT_MS = 15_000;
const NONCE = "nonce-a";

let server: Server;
let children: ChildProcess[];
let spawnedAt: number[];
let store: InMemoryPendingVoiceCallStore;

function spawnChild(): ChildProcess {
  spawnedAt.push(performance.now());
  const child = spawn(process.execPath, [CHILD_FIXTURE], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  children.push(child);
  return child;
}

async function listen(): Promise<number> {
  const service = VoiceCallClaimService.create({ pending: store, spawnChild });
  server = createServer();
  server.on("upgrade", (req, socket, head) => {
    const nonce = (req.url ?? "").split("/").pop() ?? "";
    service.accept({
      nonce,
      url: req.url ?? "",
      method: req.method ?? "GET",
      headers: req.headers,
      head,
      socket,
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function frameText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  return Buffer.from(data).toString("utf8");
}

/** Resolves with the first status the upgrade got, and the ws if it opened. */
function dial(port: number, nonce: string): Promise<{ status: number; ws?: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/twilio/${nonce}`);
    ws.on("open", () => resolve({ status: 101, ws }));
    ws.on("unexpected-response", (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on("error", reject);
  });
}

function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

beforeEach(() => {
  children = [];
  spawnedAt = [];
  store = new InMemoryPendingVoiceCallStore();
});

afterEach(async () => {
  for (const child of children) child.kill();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server?.closeAllConnections();
});

describe("VoiceCallClaimService", () => {
  describe("given a pending call for a nonce", () => {
    beforeEach(() => {
      store.add({ nonce: NONCE });
    });

    describe("when the fake Twilio client upgrades at /twilio/:nonce", () => {
      it(
        "spawns a child that completes the media handshake within the budget",
        async () => {
          const port = await listen();
          const { status, ws } = await dial(port, NONCE);
          const elapsedMs = performance.now() - spawnedAt[0]!;
          console.info(`voice-claim spike: spawn-to-101 = ${elapsedMs.toFixed(0)} ms`);
          ws?.close();
          expect({
            status,
            spawned: spawnedAt.length,
            withinBudget: elapsedMs < VOICE_CLAIM_HANDSHAKE_BUDGET_MS,
          }).toEqual({
            status: 101,
            spawned: 1,
            withinBudget: true,
          });
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "echoes a start frame through the child",
        async () => {
          const port = await listen();
          const { ws } = await dial(port, NONCE);
          const echoed = new Promise<string>((resolve) =>
            ws!.once("message", (d) => resolve(frameText(d))),
          );
          ws!.send('{"event":"start"}');
          expect(await echoed).toBe('echo:{"event":"start"}');
          ws!.close();
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the nonce is used a second time", () => {
      it(
        "refuses the second upgrade 403",
        async () => {
          const port = await listen();
          const first = await dial(port, NONCE);
          const second = await dial(port, NONCE);
          first.ws?.close();
          expect(second.status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns only one child",
        async () => {
          const port = await listen();
          const first = await dial(port, NONCE);
          await dial(port, NONCE);
          first.ws?.close();
          expect(spawnedAt).toHaveLength(1);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when Twilio sends connected and start in the same write as the upgrade request", () => {
      it(
        "delivers both frames to the child, in order",
        async () => {
          const port = await listen();
          const raw: Socket = connect(port, "127.0.0.1");
          const request =
            `GET /twilio/${NONCE} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
          raw.write(
            Buffer.concat([
              Buffer.from(request),
              maskedTextFrame("connected"),
              maskedTextFrame("start"),
            ]),
          );
          const received = await new Promise<string>((resolve) => {
            let buffer = "";
            raw.on("data", (chunk) => {
              buffer += chunk.toString("latin1");
              if (buffer.includes("echo:connected") && buffer.includes("echo:start"))
                resolve(buffer);
            });
          });
          raw.destroy();
          expect(received.indexOf("echo:connected")).toBeLessThan(received.indexOf("echo:start"));
        },
        TEST_TIMEOUT_MS,
      );
    });
  });

  describe("given no pending call for the nonce", () => {
    describe("when the fake Twilio client upgrades", () => {
      it(
        "refuses the upgrade 403",
        async () => {
          const port = await listen();
          expect((await dial(port, "unknown")).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns no child",
        async () => {
          const port = await listen();
          await dial(port, "unknown");
          expect(spawnedAt).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );
    });
  });
});
