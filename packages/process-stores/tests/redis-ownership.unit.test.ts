/**
 * The one Redis connection a process opens, and when it closes.
 * Spec: specs/server/redis-client-ownership.feature, api-process-eventing.feature
 */
import { createServer, type Socket } from "node:net";

import { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { buildProcessStores } from "../src/create-members.ts";
import { producerEventing } from "../src/eventing-role.ts";
import type { ProcessConfig } from "../src/index.ts";

/** A process whose Redis names an address nothing answers on: the client connects lazily. */
function config(overrides: Partial<ProcessConfig> = {}): ProcessConfig {
  return {
    processName: "test",
    encryptionKey: Buffer.alloc(32, 7).toString("hex"),
    secrets: {},
    rateLimit: { requests: 10, seconds: 60 },
    redis: { url: "redis://127.0.0.1:1" },
    ...overrides,
  };
}

describe("given a process configured with Redis", () => {
  describe("when a caller reads the Redis client twice", () => {
    /** @scenario "The composition root exposes the connection it created" */
    it("answers the one connection the process created", async () => {
      const members = buildProcessStores({ config: config() }).members;
      try {
        const first = members.read("redis");
        expect(members.read("redis")).toBe(first);
      } finally {
        await members.close();
      }
    });
  });

  describe("when the process closes", () => {
    /** @scenario "Closing the application closes the connection" */
    it("disconnects the connection", async () => {
      const members = buildProcessStores({ config: config() }).members;
      const connection = members.read("redis");
      const disconnect = vi.spyOn(connection, "disconnect");

      await members.close();

      expect(disconnect).toHaveBeenCalledOnce();
    });
  });

  describe("when its eventing runtime dispatches through that connection", () => {
    /** @scenario "The runtime is released before the connection under it" */
    it("releases the runtime before the connection under it", async () => {
      const order: string[] = [];
      const members = buildProcessStores({
        config: config({ eventing: producerEventing({ executionTarget: "web" }) }),
        members: { prisma: new PrismaClient({ accelerateUrl: "prisma://localhost/test" }) },
      }).members;
      const eventing = members.read("eventing");
      const connection = members.read("redis");
      const closeEventing = eventing.close.bind(eventing);
      const closing = vi.spyOn(eventing, "close").mockImplementation(async () => {
        order.push("eventing");
        await closeEventing();
      });
      const disconnect = connection.disconnect.bind(connection);
      vi.spyOn(connection, "disconnect").mockImplementation(() => {
        order.push("redis");
        disconnect();
      });

      await members.close();

      expect(closing).toHaveBeenCalledOnce();
      expect(order).toEqual(["eventing", "redis"]);
    });
  });
});

/** A listener that counts the connections dialled at it and never answers. */
async function listenCounting() {
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no listening port");
  return {
    url: `redis://127.0.0.1:${address.port}`,
    dialled: () => sockets.length,
    async stop() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe("given a Redis-backed member a request handler reads", () => {
  describe("when the process stores are built and the member has not been read", () => {
    /** @scenario "A request handler resolves the connection when it runs" */
    it("resolves no connection until the member is read, then the process's one connection", async () => {
      const redis = await listenCounting();
      const members = buildProcessStores({ config: config({ redis: { url: redis.url } }) }).members;
      try {
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(redis.dialled()).toBe(0);

        const limiter = members.read("rateLimiter");

        expect(limiter).toBeDefined();
        await vi.waitFor(() => expect(redis.dialled()).toBe(1));
        const connection = members.read("redis");
        expect(members.read("redis")).toBe(connection);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(redis.dialled()).toBe(1);
      } finally {
        await members.close();
        await redis.stop();
      }
    });
  });
});
