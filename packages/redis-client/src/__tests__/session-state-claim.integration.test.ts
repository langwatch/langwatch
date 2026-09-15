import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionStateStoreFactory } from "../session-state.factory.ts";

function waitForReady(server: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Redis startup timed out")), 5000);
    server.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Redis exited during startup with code ${code}`));
    });
    server.stdout?.on("data", (chunk: Buffer) => {
      const ready = /ready to accept connections/i.test(chunk.toString());
      if (ready) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

describe("Redis session state claims", () => {
  let directory: string | null = null;
  let server: ChildProcess | null = null;
  let connections: Redis[] = [];

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "agent-claim-"));
    const socket = join(directory, "redis.sock");
    server = spawn("redis-server", [
      "--port",
      "0",
      "--unixsocket",
      socket,
      "--unixsocketperm",
      "700",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      directory,
    ]);
    await waitForReady(server);

    connections = [
      new Redis(socket, { lazyConnect: true, retryStrategy: () => null }),
      new Redis(socket, { lazyConnect: true, retryStrategy: () => null }),
    ];
    await Promise.all(connections.map((connection) => connection.connect()));
  });

  afterAll(async () => {
    for (const connection of connections) {
      connection.disconnect();
    }
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  function clients(): [Redis, Redis] {
    const [first, second] = connections;
    if (!first || !second) {
      throw new Error("Redis connections are not ready");
    }
    return [first, second];
  }

  it("admits exactly one principal when two independent clients compete", async () => {
    const [firstClient, secondClient] = clients();
    const first = SessionStateStoreFactory.redis(firstClient);
    const second = SessionStateStoreFactory.redis(secondClient);

    const claims = await Promise.all([
      first.setIfAbsentOrEqual("competing", "alice", 600),
      second.setIfAbsentOrEqual("competing", "bob", 600),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = claims[0] ? "alice" : "bob";
    expect(await first.tryGet("competing")).toBe(winner);
    expect(await second.tryGet("competing")).toBe(winner);
  });

  it("renews only the owner and permits a new owner after expiration", async () => {
    const [firstClient, secondClient] = clients();
    const first = SessionStateStoreFactory.redis(firstClient);
    const second = SessionStateStoreFactory.redis(secondClient);
    expect(await first.setIfAbsentOrEqual("renewable", "alice", 600)).toBe(true);

    await firstClient.pexpire("renewable", 120_000);
    const expiration = await firstClient.pexpiretime("renewable");
    expect(await second.setIfAbsentOrEqual("renewable", "bob", 600)).toBe(false);
    expect(await firstClient.pexpiretime("renewable")).toBe(expiration);
    expect(await first.tryGet("renewable")).toBe("alice");

    expect(await second.setIfAbsentOrEqual("renewable", "alice", 600)).toBe(true);
    expect(await firstClient.pexpiretime("renewable")).toBeGreaterThan(expiration + 300_000);

    await firstClient.pexpire("renewable", 0);
    expect(await first.tryGet("renewable")).toBeNull();
    expect(await second.setIfAbsentOrEqual("renewable", "bob", 600)).toBe(true);
    expect(await first.tryGet("renewable")).toBe("bob");
  });
});
