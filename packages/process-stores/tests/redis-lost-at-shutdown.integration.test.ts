/**
 * @vitest-environment node
 * A worker's group queue closing on a lost Redis, once the door has told the stores to begin.
 * Spec: specs/server/redis-client-ownership.feature
 */
import { createServer, type Server, type Socket } from "node:net";

import { GroupQueueProcessor } from "@langwatch/group-queue";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildProcessStores, hostedStores } from "../src/create-members.ts";
import type { ProcessConfig } from "../src/index.ts";

/** The command name at the front of one RESP array, and how much of the buffer it used. */
function takeCommand(buffer: Buffer): { name: string; used: number } | undefined {
  let at = buffer.indexOf("\r\n");
  if (at < 0 || buffer[0] !== 0x2a) return undefined;
  const count = Number(buffer.subarray(1, at).toString());
  let offset = at + 2;
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    at = buffer.indexOf("\r\n", offset);
    if (at < 0) return undefined;
    const length = Number(buffer.subarray(offset + 1, at).toString());
    const start = at + 2;
    if (buffer.length < start + length + 2) return undefined;
    args.push(buffer.subarray(start, start + length).toString());
    offset = start + length + 2;
  }
  return { name: (args[0] ?? "").toLowerCase(), used: offset };
}

const HANDSHAKE: Record<string, string> = {
  info: "$9\r\nloading:0\r\n",
  ping: "+PONG\r\n",
  select: "+OK\r\n",
  client: "+OK\r\n",
  auth: "+OK\r\n",
};

/** Answers the handshake and nothing else, so queue commands are in flight when it goes. */
async function silentRedis(): Promise<{ url: string; goAway: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      for (let command = takeCommand(pending); command; command = takeCommand(pending)) {
        pending = pending.subarray(command.used);
        const answer = HANDSHAKE[command.name];
        if (answer !== undefined) socket.write(answer);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return {
    url: `redis://127.0.0.1:${address.port}`,
    goAway: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; tries < 300 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

function configFor(url: string): ProcessConfig {
  return {
    processName: "redis-lost-at-shutdown",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    database: { url: "postgresql://127.0.0.1:1/unused" },
    redis: { url },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a worker's group queue whose Redis has gone away", () => {
  describe("when the door tells the stores shutdown has begun and the queue closes", () => {
    /** @scenario "A worker's group queue closes promptly on a lost Redis" */
    it("ends the runtime's close within about a second", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(console, "info").mockImplementation(() => undefined);
      const redisServer = await silentRedis();
      const members = buildProcessStores({ config: configFor(redisServer.url) }).members;
      const connection = members.read("redis");
      const queue = new GroupQueueProcessor<{ id: string; groupId: string }>(
        {
          name: `{test/gq/lost/${crypto.randomUUID().slice(0, 8)}}`,
          process: async () => {},
          groupKey: (payload) => payload.groupId,
          identify: (payload) => payload.id,
        },
        connection,
        { consumerEnabled: true },
      );
      try {
        await until(() => connection.status === "ready");
        await redisServer.goAway();
        await until(() => connection.status === "reconnecting");

        const started = performance.now();
        hostedStores(members).stopping();
        await queue.close();
        await members.close();

        expect(performance.now() - started).toBeLessThan(1500);
      } finally {
        connection.disconnect();
      }
    });
  });
});
