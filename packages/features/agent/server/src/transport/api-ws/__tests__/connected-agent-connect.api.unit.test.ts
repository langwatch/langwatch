/**
 * The gateway's own guards, with no datastore: the payload caps on a result,
 * and the refusal of a connection when Redis is absent on a deployment with
 * several replicas.
 *
 * @see specs/agents/connected-agents.feature
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { type Agent, type AgentService, PROTOCOL_VERSION, relayPayloadCaps } from "@langwatch/agent-contract";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { resultCapViolation } from "../../../adapters/connected-agent-envelope.adapter";
import {
  createConnectedAgentRuntime,
  type ConnectedAgentRuntime,
} from "../../../services/connected-agent-runtime.service";
import { createMemoryStateStore } from "../../../adapters/connected-agent-state.adapter";
import type { AgentRepository } from "../../../repositories/agent.repository";
import type { ConnectCredentialPort } from "../../../ports/connect-credential.port";
import type {
  ConnectUpgradeRouterPort,
  UpgradeHandler,
} from "../../../ports/connect-upgrade-router.port";
import { CONNECT_PATH, ConnectGateway } from "../connected-agent-connect.api";

/** The minimal router a standalone `http.Server` needs, main's shape. */
function createUpgradeRouter(server: Server): ConnectUpgradeRouterPort {
  const handlers = new Map<string, UpgradeHandler>();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = handlers.get(pathname);
    if (!handler) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    handler(request, socket, head);
  });
  return {
    register(pathname, handler) {
      if (handlers.has(pathname)) {
        throw new Error(`An upgrade handler is already registered for ${pathname}`);
      }
      handlers.set(pathname, handler);
    },
  };
}

const fakeAgents = {} as AgentService;
const fakeAgentRepository = {} as AgentRepository;
const fakeCredentials = {} as ConnectCredentialPort;
const fakeAgentPlatformUrl = () => "https://example.test/agents";

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
      expect(resultCapViolation({ output: "small", session: undefined, caps })).toBeNull();
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
      expect(resultCapViolation({ output: "ok", session: { id: "s1" }, caps })).toBeNull();
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
      agents: fakeAgents,
      agentRepository: fakeAgentRepository,
      credentials: fakeCredentials,
      agentPlatformUrl: fakeAgentPlatformUrl,
      replicaCount: 3,
    });
    gateway.mount(createUpgradeRouter(server));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
      const refused = await new Promise<Record<string, unknown>>((resolve, reject) => {
        socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
        socket.once("error", reject);
      });
      expect(refused).toMatchObject({
        type: "refused",
        code: "replica_count_unsupported",
      });
      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
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

/** A fake `AgentService` that upserts nothing, just echoes what it was given. */
function registeringAgentService(): AgentService {
  return {
    registerConnected: async (input) =>
      ({
        id: input.id,
        name: input.name,
        environment: input.identity.environment,
        type: "connected",
      }) as unknown as Agent,
  } as unknown as AgentService;
}

const noopAgentRepository = { touchLastSeenAt: async () => undefined } as unknown as AgentRepository;

const resolvingCredentials = {
  resolve: async () => ({ project: { id: "proj_1", slug: "proj-one" }, userId: null }),
} as unknown as ConnectCredentialPort;

function registerFrame(overrides: { name?: string; instanceId?: string } = {}) {
  return {
    protocol: PROTOCOL_VERSION,
    type: "register" as const,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    instance: {
      id: overrides.instanceId ?? "inst_1",
      hostname: "laptop",
      username: "dev",
      pid: 1,
      startedAt: new Date().toISOString(),
      inFlightCallIds: [],
    },
    agents: [{ name: overrides.name ?? "support-agent", environment: "production", parameters: {} }],
  };
}

/** One pod with a real socket server, a real gateway, and a registering process. */
async function startPod({
  pingIntervalMs = 10_000,
  pongWaitMs = 200,
}: { pingIntervalMs?: number; pongWaitMs?: number } = {}) {
  const runtime = createConnectedAgentRuntime({
    podId: `pod_${Math.random().toString(36).slice(2)}`,
    store: createMemoryStateStore(),
  });
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const gateway = new ConnectGateway({
    runtime,
    agents: registeringAgentService(),
    agentRepository: noopAgentRepository,
    credentials: resolvingCredentials,
    agentPlatformUrl: () => "https://example.test/agents",
    replicaCount: 1,
    pingIntervalMs,
    pongWaitMs,
  });
  gateway.mount(createUpgradeRouter(server));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { runtime, gateway, server, url };
}

async function stopPod(pod: Awaited<ReturnType<typeof startPod>>) {
  await pod.gateway.close();
  await new Promise<void>((resolve) => pod.server.close(() => resolve()));
}

function connectAndRegister(
  url: string,
  frame: ReturnType<typeof registerFrame>,
): { socket: WebSocket; registered: Promise<Record<string, unknown>> } {
  const socket = new WebSocket(`${url}${CONNECT_PATH}`, {
    headers: { Authorization: "Bearer sk-lw-anything" },
  });
  const registered = new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once("open", () => socket.send(JSON.stringify(frame)));
    socket.once("message", (raw) => resolve(JSON.parse(raw.toString())));
    socket.once("error", reject);
  });
  return { socket, registered };
}

describe("ConnectGateway socket lifecycle", () => {
  let pod: Awaited<ReturnType<typeof startPod>>;

  afterEach(async () => {
    if (pod) await stopPod(pod);
  });

  describe("when the instance does not answer a ping inside the pong wait", () => {
    /** @scenario "A missed pong retires the instance" */
    it("closes the socket and the instance is no longer live", async () => {
      pod = await startPod({ pingIntervalMs: 30, pongWaitMs: 30 });
      const { socket, registered } = connectAndRegister(pod.url, registerFrame());
      // A ws client answers pings automatically unless told not to.
      socket.pong = () => undefined as never;
      await registered;

      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
      // The client sees its own close before the server finishes its onClose.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(pod.gateway.sessionCount).toBe(0);
    });
  });

  describe("when the pong lands inside the wait of its own ping, after the next ping already went out", () => {
    /** @scenario "A pong that lands inside its own wait keeps the socket" */
    it("keeps the socket open and the instance live", async () => {
      pod = await startPod({ pingIntervalMs: 40, pongWaitMs: 150 });
      const { socket, registered } = connectAndRegister(pod.url, registerFrame());
      await registered;

      // Two pings will have gone out before this one pong answers; the pong
      // still lands inside the wait of the ping that is currently open.
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(pod.gateway.sessionCount).toBe(1);
      expect(socket.readyState).toBe(WebSocket.OPEN);
      socket.close();
    });
  });

  describe("when the socket closes while its registration is still running", () => {
    /** @scenario "A socket that goes away during registration retires its instance" */
    it("holds no connection for it once the registration finishes", async () => {
      let releaseRegister: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        releaseRegister = resolve;
      });
      const slowAgents: AgentService = {
        registerConnected: async (input) => {
          await gate;
          return {
            id: input.id,
            name: input.name,
            environment: input.identity.environment,
            type: "connected",
          } as unknown as Agent;
        },
      } as unknown as AgentService;

      const runtime = createConnectedAgentRuntime({
        podId: "pod_slow",
        store: createMemoryStateStore(),
      });
      const server = createServer((_request, response) => {
        response.statusCode = 404;
        response.end();
      });
      const gateway = new ConnectGateway({
        runtime,
        agents: slowAgents,
        agentRepository: noopAgentRepository,
        credentials: resolvingCredentials,
        agentPlatformUrl: () => "https://example.test/agents",
        replicaCount: 1,
      });
      gateway.mount(createUpgradeRouter(server));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;

      const socket = new WebSocket(`${url}${CONNECT_PATH}`, {
        headers: { Authorization: "Bearer sk-lw-anything" },
      });
      await new Promise<void>((resolve) => socket.once("open", () => resolve()));
      socket.send(JSON.stringify(registerFrame()));
      // The socket goes away before registerConnected ever answers.
      socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 20));
      releaseRegister?.();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(gateway.sessionCount).toBe(0);
      await gateway.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
  });

});

describe("AgentSessionCore.readCallForSession", () => {
  describe("given an instance that registered agent A only, and a call routed at it for agent B", () => {
    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("is not handed the call, and the call is marked undelivered for a retry elsewhere", async () => {
      const store = createMemoryStateStore();
      const runtime = createConnectedAgentRuntime({ podId: "pod_solo", store });
      const core = new (
        await import("../../../services/connected-agent-session.service")
      ).AgentSessionCore({
        runtime,
        agents: registeringAgentService(),
        agentRepository: noopAgentRepository,
        credentials: resolvingCredentials,
        agentPlatformUrl: () => "https://example.test/agents",
        replicaCount: 1,
      });
      const session = {
        instanceId: "inst_1",
        projectId: "proj_1",
        projectSlug: "proj-one",
        agentIds: new Set(["agent_a"]),
        meta: {
          instanceId: "inst_1",
          projectId: "proj_1",
          hostname: "laptop",
          username: "dev",
          pid: 1,
          sdk: { name: "langwatch", version: "1.0.0", language: "python" },
          label: null,
          podId: "pod_solo",
          connectedAt: Date.now(),
          maxConcurrency: 1,
        },
      };
      const stored = {
        projectId: "proj_1",
        instanceId: "inst_1",
        replyTo: "pod_solo",
        envelope: {
          callId: "call_1",
          agentId: "agent_b",
          threadId: "thread_1",
          messages: [{ role: "user", content: "hi" }],
          newMessages: [{ role: "user", content: "hi" }],
          params: {},
          session: null,
          traceparent: null,
          deadlineAt: Date.now() + 60_000,
          run: {},
        },
      };
      await store.set("agent_call:v1:proj_1:call_1", JSON.stringify(stored), 60);

      const call = await core.readCallForSession(session, "call_1");

      expect(call).toBeNull();
      const result = await store.get("agent_result:v1:proj_1:call_1");
      expect(result && JSON.parse(result)).toMatchObject({
        instanceId: "inst_1",
        undelivered: true,
      });
    });
  });
});
