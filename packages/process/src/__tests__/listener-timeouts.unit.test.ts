import diagnostics from "node:diagnostics_channel";
import type http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_LISTENER_TIMEOUTS,
  startLivenessThread,
  type LivenessThread,
} from "../lifecycle/liveness-thread.ts";
import { Server } from "../server.ts";

/** 5 GiB in two hours is about 6 Mbit/s: the slowest upload link the api still serves. */
const TWO_HOURS_MS = 2 * 60 * 60_000;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const servers: Server[] = [];
const threads: LivenessThread[] = [];

afterEach(async () => {
  await Promise.all(threads.splice(0).map((thread) => thread.close({ graceMs: 50 })));
  await Promise.all(servers.splice(0).map((server) => server.close()));
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

describe("the public HTTP listener", () => {
  describe("when the api's HTTP listener starts on the main loop", () => {
    /** @scenario "The api allows an upload body up to two hours" */
    it("gives a request body two hours and adds no idle socket timeout", async () => {
      const server = Server.create({ name: "test-server", logger, ownsProcess: false });
      servers.push(server);
      await server.listen();
      const { port } = server.healthAddress as AddressInfo;

      const listener = await listenerAnswering(`http://localhost:${port}/healthz`);

      expect(listener.requestTimeout).toBe(TWO_HOURS_MS);
      expect(listener.timeout).toBe(0);
      expect(listener.headersTimeout).toBe(PUBLIC_LISTENER_TIMEOUTS.headersTimeout);
      expect(listener.keepAliveTimeout).toBe(PUBLIC_LISTENER_TIMEOUTS.keepAliveTimeout);
    });
  });

  describe("when the liveness thread owns the api's public port", () => {
    /** @scenario "The api allows an upload body up to two hours" */
    it("gives a request body two hours and adds no idle socket timeout", async () => {
      const thread = await startLivenessThread({
        port: 0,
        heartbeat: new BigInt64Array(new SharedArrayBuffer(8)).buffer as SharedArrayBuffer,
        proxyPort: 1,
        logger,
      });
      threads.push(thread);

      expect(thread.listenerTimeouts).toEqual({
        requestTimeout: TWO_HOURS_MS,
        headersTimeout: PUBLIC_LISTENER_TIMEOUTS.headersTimeout,
        keepAliveTimeout: PUBLIC_LISTENER_TIMEOUTS.keepAliveTimeout,
        timeout: 0,
      });
    });
  });
});
