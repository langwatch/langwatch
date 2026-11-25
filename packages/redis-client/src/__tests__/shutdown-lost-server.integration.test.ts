import { createServer, type Server, type Socket } from "node:net";

import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RedisConnectionService } from "../connection.ts";
import { RedisShutdownService } from "../shutdown.ts";

/** Reads one RESP array of bulk strings from the front of a buffer. */
function takeCommand(buffer: Buffer): { args: string[]; rest: Buffer } | undefined {
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
  return { args, rest: buffer.subarray(offset) };
}

function reply(args: string[]): string {
  const name = args[0]?.toLowerCase();
  if (name === "info") return "$9\r\nloading:0\r\n";
  if (name === "ping") return "+PONG\r\n";
  if (name === "get") return "$5\r\nvalue\r\n";
  return "+OK\r\n";
}

/** Just enough of a Redis server to reach `ready`, and to go away on demand. */
async function fakeRedis(): Promise<{ url: string; goAway: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (let command = takeCommand(pending); command; command = takeCommand(pending)) {
        pending = command.rest;
        socket.write(reply(command.args));
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
  for (let tries = 0; tries < 200 && !condition(); tries += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
}

function connect(url: string): Redis {
  const connection = new RedisConnectionService().connectStandalone({ url });
  if (connection === null) throw new Error("no connection");
  return connection;
}

const opened: Redis[] = [];

afterEach(() => {
  for (const connection of opened.splice(0)) connection.disconnect();
  vi.restoreAllMocks();
});

describe("a connection whose Redis goes away during shutdown", () => {
  /** @scenario "A connection whose Redis went away closes promptly at shutdown" */
  it("quits within the bound, fails the waiting command and stops reconnecting", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const server = await fakeRedis();
    const connection = connect(server.url);
    const duplicate = connection.duplicate();
    opened.push(connection, duplicate);
    await until(() => connection.status === "ready" && duplicate.status === "ready");

    await server.goAway();
    await until(() => duplicate.status === "reconnecting");
    const waiting = duplicate.get("key");
    const reconnects = vi.fn();
    connection.on("reconnecting", reconnects);
    duplicate.on("reconnecting", reconnects);

    const started = performance.now();
    RedisShutdownService.create().beginShutdown(connection);
    await expect(duplicate.quit()).resolves.toBe("OK");
    await expect(waiting).rejects.toThrow("Connection is closed");
    await RedisShutdownService.create().shutdown(connection);
    expect(performance.now() - started).toBeLessThan(1000);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(reconnects).not.toHaveBeenCalled();
    expect([connection.status, duplicate.status]).toEqual(["end", "end"]);
  });

  /** @scenario "A lost Redis at shutdown logs no unhandled error events" */
  it("gives a duplicate an error listener and logs the loss once at info", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const infos = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const server = await fakeRedis();
    const connection = connect(server.url);
    const duplicate = connection.duplicate();
    opened.push(connection, duplicate);
    expect(duplicate.listenerCount("error")).toBeGreaterThan(0);
    await until(() => connection.status === "ready" && duplicate.status === "ready");

    RedisShutdownService.create().beginShutdown(connection);
    await server.goAway();
    await until(() => connection.status === "end" && duplicate.status === "end");

    const lines = errors.mock.calls.map((call) => String(call[0]));
    expect(lines.filter((line) => line.includes("Unhandled error event"))).toEqual([]);
    expect(infos.mock.calls.length).toBeLessThanOrEqual(1);
  });

  /** @scenario "A reachable Redis still drains at shutdown" */
  it("answers a command sent after shutdown began, then quits", async () => {
    const server = await fakeRedis();
    const connection = connect(server.url);
    opened.push(connection);
    await until(() => connection.status === "ready");

    RedisShutdownService.create().beginShutdown(connection);
    const answered = connection.get("key");
    await expect(connection.quit()).resolves.toBe("OK");
    await expect(answered).resolves.toBe("value");
    await server.goAway();
  });
});
