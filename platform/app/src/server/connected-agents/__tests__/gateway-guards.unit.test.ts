/**
 * The gateway's own guards, with no datastore: the payload caps on a result,
 * and the refusal of a connection when Redis is absent on a deployment with
 * several replicas.
 *
 * @see specs/agents/connected-agents.feature
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { PrismaClient } from "~/generated/prisma/client";
import { createUpgradeRouter } from "~/server/websockets/upgrade-router";
import { resultCapViolation } from "../call-envelope";
import { CONNECT_PATH, ConnectGateway } from "../connect.gateway";
import { relayPayloadCaps } from "../constants";
import { createConnectedAgentRuntime } from "../runtime";
import { createMemoryStateStore } from "../state-store";

describe("resultCapViolation", () => {
  const caps = relayPayloadCaps(1);

  describe("when the output is above the result cap", () => {
    /** @scenario "A result above the result cap is refused" */
    it("names the result cap", () => {
      const output = "x".repeat(caps.resultBytes + 10);
      expect(resultCapViolation({ output, session: undefined, caps })).toEqual({
        what: "result",
        sizeBytes: expect.any(Number),
        limitBytes: caps.resultBytes,
      });
      expect(
        resultCapViolation({ output: "small", session: undefined, caps }),
      ).toBeNull();
    });
  });

  describe("when the session is above the session cap", () => {
    /** @scenario "A session above the session cap is refused" */
    it("names the session cap", () => {
      const session = { token: "y".repeat(caps.sessionBytes + 10) };
      expect(resultCapViolation({ output: "ok", session, caps })).toEqual({
        what: "session",
        sizeBytes: expect.any(Number),
        limitBytes: caps.sessionBytes,
      });
      expect(
        resultCapViolation({ output: "ok", session: { id: "s1" }, caps }),
      ).toBeNull();
    });
  });
});

describe("ConnectGateway without Redis", () => {
  let server: Server;
  let gateway: ConnectGateway;
  let url: string;

  beforeAll(async () => {
    const runtime = createConnectedAgentRuntime({
      podId: "pod_solo",
      store: createMemoryStateStore(),
    });
    server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    gateway = new ConnectGateway({
      runtime,
      // Never reached: the replica check refuses before any credential read.
      prisma: {} as PrismaClient,
      replicaCount: 3,
    });
    gateway.mount(createUpgradeRouter(server));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("when the deployment has several replicas", () => {
    /** @scenario "Connect is refused without Redis on a deployment with several replicas" */
    it("refuses with replica_count_unsupported", async () => {
      const socket = new WebSocket(`${url}${CONNECT_PATH}`, {
        headers: { Authorization: "Bearer sk-lw-anything" },
      });
      const refused = await new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
          socket.once("error", reject);
        },
      );
      expect(refused).toMatchObject({
        type: "refused",
        code: "replica_count_unsupported",
      });
      await new Promise<void>((resolve) =>
        socket.once("close", () => resolve()),
      );
    });
  });

  describe("when the upgrade path is unknown", () => {
    it("answers 404 instead of hanging", async () => {
      const socket = new WebSocket(`${url}/api/nothing-here`);
      const status = await new Promise<number>((resolve) => {
        socket.once("unexpected-response", (_request, response) =>
          resolve(response.statusCode ?? 0),
        );
        socket.once("error", () => resolve(-1));
      });
      expect(status).toBe(404);
    });
  });
});
