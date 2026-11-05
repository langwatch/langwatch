// The pod that receives the Twilio media upgrade checks the pending call and Twilio's signature,
// claims the call, then spawns the child and hands it the raw socket.
// Signatures are synthetic, computed here with node:crypto; no real Twilio traffic.
// @see specs/features/agents/voice-media-claim.feature
import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { MemoryPendingVoiceCallRepository } from "../../../../repositories/memory/memory.pending-voice-call.repository.ts";
import { MemoryScenarioCancellationRepository } from "../../../../repositories/memory/memory.scenario-cancellation.repository.ts";
import type { PendingVoiceCall } from "../../../../repositories/pending-voice-call.repository.ts";
import { VoiceCallClaimService } from "../voice-call-claim.service.ts";
import { frameText } from "./fixtures/frame-text.ts";

const CHILD_FIXTURE = fileURLToPath(new URL("./fixtures/voice-echo-child.ts", import.meta.url));
const TEST_TIMEOUT_MS = 15_000;
const PUBLIC_BASE_URL = "wss://voice.example.test";
const AUTH_TOKEN = "synthetic-auth-token";
const CALL: PendingVoiceCall = {
  nonce: "nonce-a",
  projectId: "project-1",
  scenarioRunId: "run-a",
};
const PATH = `/twilio/${CALL.scenarioRunId}/${CALL.nonce}`;

let server: Server;
let children: ChildProcess[];
let clients: WebSocket[];
let rawSockets: Socket[];
let pending: MemoryPendingVoiceCallRepository;
let cancellations: MemoryScenarioCancellationRepository;
let spawnOverride: (() => ChildProcess) | undefined;

function sign({ authToken, path }: { authToken: string; path: string }): string {
  return createHmac("sha1", authToken).update(`${PUBLIC_BASE_URL}${path}`).digest("base64");
}

const validSignature = (): string => sign({ authToken: AUTH_TOKEN, path: PATH });

function spawnChildWithoutIpc(): ChildProcess {
  const child = spawn(process.execPath, [CHILD_FIXTURE], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  return child;
}

function spawnChild(): ChildProcess {
  const child = spawn(process.execPath, [CHILD_FIXTURE], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  children.push(child);
  return child;
}

async function listen(): Promise<number> {
  const service = VoiceCallClaimService.create({
    pending,
    authTokenFor: async () => AUTH_TOKEN,
    publicBaseUrl: PUBLIC_BASE_URL,
    spawnChild: () => (spawnOverride ?? spawnChild)(),
    cancellations,
  });
  server = createServer();
  server.on("upgrade", (req, socket, head) => {
    service.accept({
      nonce: (req.url ?? "").split("/").pop() ?? "",
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

/** Resolves with the first status the upgrade got, and the ws if it opened. */
function dial({
  port,
  path = PATH,
  signature,
}: {
  port: number;
  path?: string;
  signature?: string;
}): Promise<{ status: number; ws?: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, {
      headers: signature === undefined ? {} : { "X-Twilio-Signature": signature },
    });
    clients.push(ws);
    ws.on("open", () => resolve({ status: 101, ws }));
    ws.on("unexpected-response", (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.on("error", (error) => {
      ws.terminate();
      reject(error);
    });
  });
}

async function spawnedChild(): Promise<ChildProcess> {
  const deadline = Date.now() + 5_000;
  while (children.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return children[0]!;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function exited(child: ChildProcess): Promise<void> {
  return hasExited(child)
    ? Promise.resolve()
    : new Promise((resolve) => child.once("exit", () => resolve()));
}

// One-byte length form only (payload < 126 bytes); enough for the frames here.
function maskedTextFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]!));
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

beforeEach(async () => {
  children = [];
  clients = [];
  rawSockets = [];
  spawnOverride = undefined;
  pending = MemoryPendingVoiceCallRepository.create();
  cancellations = MemoryScenarioCancellationRepository.create();
});

afterEach(async () => {
  for (const ws of clients) ws.terminate();
  for (const raw of rawSockets) raw.destroy();
  await Promise.all(
    children
      .filter((child) => !hasExited(child))
      .map((child) => {
        const done = exited(child);
        child.kill("SIGKILL");
        return done;
      }),
  );
  if (server) {
    // Not awaited: a socket handed to a child never closes in this process.
    server.close();
    server.closeAllConnections();
  }
});

describe("VoiceCallClaimService", () => {
  describe("given a pending call", () => {
    beforeEach(async () => {
      await pending.put({ call: CALL, ttlSeconds: 60 });
    });

    describe("when a validly signed upgrade arrives at /twilio/:scenarioRunId/:nonce", () => {
      /** @scenario "A valid upgrade claims the call and hands the socket to a fresh child" */
      it(
        "accepts the upgrade",
        async () => {
          const port = await listen();
          const { status, ws } = await dial({ port, signature: validSignature() });
          ws?.close();
          expect(status).toBe(101);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "echoes a start frame through the spawned child",
        async () => {
          const port = await listen();
          const { ws } = await dial({ port, signature: validSignature() });
          const echoed = new Promise<string>((resolve) =>
            ws!.once("message", (d) => resolve(frameText(d))),
          );
          ws!.send('{"event":"start"}');
          expect(await echoed).toBe('echo:{"event":"start"}');
          ws!.close();
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "marks the call claimed",
        async () => {
          const port = await listen();
          const { ws } = await dial({ port, signature: validSignature() });
          ws?.close();
          await expect(
            pending.claim({ scenarioRunId: CALL.scenarioRunId, nonce: CALL.nonce }),
          ).resolves.toEqual({ claimed: false, reason: "unknown" });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the upgrade carries a wrong signature", () => {
      /** @scenario "A bad signature leaves the nonce claimable" */
      it(
        "refuses the upgrade 403",
        async () => {
          const port = await listen();
          const bad = sign({ authToken: "another-token", path: PATH });
          expect((await dial({ port, signature: bad })).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns no child",
        async () => {
          const port = await listen();
          await dial({ port, signature: sign({ authToken: "another-token", path: PATH }) });
          expect(children).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "leaves the call peekable",
        async () => {
          const port = await listen();
          await dial({ port, signature: sign({ authToken: "another-token", path: PATH }) });
          await expect(
            pending.peek({ scenarioRunId: CALL.scenarioRunId, nonce: CALL.nonce }),
          ).resolves.toEqual({ found: true, call: CALL });
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "lets a correctly signed upgrade claim it afterwards",
        async () => {
          const port = await listen();
          await dial({ port, signature: sign({ authToken: "another-token", path: PATH }) });
          const retry = await dial({ port, signature: validSignature() });
          retry.ws?.close();
          expect(retry.status).toBe(101);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the upgrade carries no signature header", () => {
      /** @scenario "An upgrade without a signature is refused and leaves the call pending" */
      it(
        "refuses the upgrade 403",
        async () => {
          const port = await listen();
          expect((await dial({ port })).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "leaves the call peekable",
        async () => {
          const port = await listen();
          await dial({ port });
          await expect(
            pending.peek({ scenarioRunId: CALL.scenarioRunId, nonce: CALL.nonce }),
          ).resolves.toEqual({ found: true, call: CALL });
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the signature is for the path of another nonce", () => {
      it(
        "refuses the upgrade 403",
        async () => {
          const port = await listen();
          const other = sign({
            authToken: AUTH_TOKEN,
            path: `/twilio/${CALL.scenarioRunId}/other`,
          });
          expect((await dial({ port, signature: other })).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the call is claimed a second time by a signed upgrade", () => {
      /** @scenario "A used nonce is refused the second time" */
      it(
        "refuses the second upgrade 403",
        async () => {
          const port = await listen();
          const first = await dial({ port, signature: validSignature() });
          const second = await dial({ port, signature: validSignature() });
          first.ws?.close();
          expect(second.status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns only one child",
        async () => {
          const port = await listen();
          const first = await dial({ port, signature: validSignature() });
          await dial({ port, signature: validSignature() });
          first.ws?.close();
          expect(children).toHaveLength(1);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the run was cancelled before the upgrade", () => {
      beforeEach(async () => {
        await pending.cancel({ scenarioRunId: CALL.scenarioRunId, tombstoneTtlSeconds: 600 });
      });

      /** @scenario "A cancelled run is refused at the door" */
      it(
        "refuses the signed upgrade 403",
        async () => {
          const port = await listen();
          expect((await dial({ port, signature: validSignature() })).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns no child",
        async () => {
          const port = await listen();
          await dial({ port, signature: validSignature() });
          expect(children).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when Twilio sends connected and start in the same write as the upgrade request", () => {
      /** @scenario "Connected and start frames sent with the upgrade reach the child in order" */
      it(
        "delivers both frames to the child, in order",
        async () => {
          const port = await listen();
          const raw: Socket = connect(port, "127.0.0.1");
          rawSockets.push(raw);
          const request =
            `GET ${PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            `X-Twilio-Signature: ${validSignature()}\r\n` +
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

    describe("when the call is claimed and its run's cancellation is broadcast", () => {
      /** @scenario "A cancellation after the claim kills the child" */
      it(
        "kills the child",
        async () => {
          const port = await listen();
          const { ws } = await dial({ port, signature: validSignature() });
          ws?.on("error", () => {});

          await cancellations.publish({
            projectId: CALL.projectId,
            scenarioRunId: CALL.scenarioRunId,
          });
          await exited(children[0]!);

          expect(hasExited(children[0]!)).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when the socket handoff to the child fails", () => {
      /** @scenario "A failed handoff kills the child and closes the socket" */
      it(
        "kills the child when the socket handoff fails",
        async () => {
          spawnOverride = spawnChildWithoutIpc;
          const port = await listen();
          const raw: Socket = connect(port, "127.0.0.1");
          rawSockets.push(raw);
          const closed = new Promise<void>((resolve) => raw.once("close", () => resolve()));
          raw.on("error", () => {});
          raw.write(
            `GET ${PATH} HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
              `X-Twilio-Signature: ${validSignature()}\r\n` +
              `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
          );

          await Promise.all([closed, exited(await spawnedChild())]);

          expect(hasExited(children[0]!)).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when two signed upgrades for the same run arrive back to back", () => {
      /** @scenario "A second upgrade for a run this pod holds is refused" */
      it(
        "refuses a second upgrade for a run this pod already holds",
        async () => {
          const port = await listen();
          const dials = await Promise.all([
            dial({ port, signature: validSignature() }),
            dial({ port, signature: validSignature() }),
          ]);
          dials.forEach(({ ws }) => ws?.on("error", () => {}));

          expect(dials.map(({ status }) => status).toSorted((a, b) => a - b)).toEqual([101, 403]);
          expect(children).toHaveLength(1);

          await cancellations.publish({
            projectId: CALL.projectId,
            scenarioRunId: CALL.scenarioRunId,
          });
          await exited(children[0]!);

          expect(hasExited(children[0]!)).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    });

    describe("when another run's cancellation is broadcast", () => {
      /** @scenario "A cancellation for another run leaves the child alone" */
      it(
        "keeps the child running",
        async () => {
          const port = await listen();
          const { ws } = await dial({ port, signature: validSignature() });

          ws?.on("error", () => {});

          await cancellations.publish({ projectId: CALL.projectId, scenarioRunId: "run-other" });
          const aliveAfterOther = !hasExited(children[0]!);
          await cancellations.publish({
            projectId: CALL.projectId,
            scenarioRunId: CALL.scenarioRunId,
          });
          await exited(children[0]!);

          expect(aliveAfterOther).toBe(true);
        },
        TEST_TIMEOUT_MS,
      );
    });
  });

  describe("given the cancellation subscription fails once", () => {
    const SECOND: PendingVoiceCall = { ...CALL, scenarioRunId: "run-b", nonce: "nonce-b" };

    it(
      "refuses the first upgrade and claims a fresh run on the next",
      async () => {
        await pending.put({ call: CALL, ttlSeconds: 60 });
        await pending.put({ call: SECOND, ttlSeconds: 60 });
        let failures = 1;
        const subscribe = cancellations.subscribe.bind(cancellations);
        cancellations.subscribe = async (onCancellation) => {
          if (failures-- > 0) throw new Error("subscribe failed");
          return subscribe(onCancellation);
        };
        const port = await listen();
        const secondPath = `/twilio/${SECOND.scenarioRunId}/${SECOND.nonce}`;

        const first = await dial({ port, signature: validSignature() }).catch(() => undefined);
        const second = await dial({
          port,
          path: secondPath,
          signature: sign({ authToken: AUTH_TOKEN, path: secondPath }),
        });
        second.ws?.close();

        expect(first?.status).not.toBe(101);
        expect(second.status).toBe(101);
      },
      TEST_TIMEOUT_MS,
    );
  });

  describe("given no pending call for the path", () => {
    describe("when a signed upgrade arrives", () => {
      /** @scenario "An upgrade for an unknown call is refused" */
      it(
        "refuses the upgrade 403",
        async () => {
          const port = await listen();
          expect((await dial({ port, signature: validSignature() })).status).toBe(403);
        },
        TEST_TIMEOUT_MS,
      );

      it(
        "spawns no child",
        async () => {
          const port = await listen();
          await dial({ port, signature: validSignature() });
          expect(children).toHaveLength(0);
        },
        TEST_TIMEOUT_MS,
      );
    });
  });
});
