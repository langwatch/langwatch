/**
 * The gateway's own guards, with no datastore: the payload caps on a result,
 * and the connection refusal with no Redis on a multi-replica deployment.
 * @see specs/agents/connected-agents.feature
 */
import { createServer, type Server, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

import { PROTOCOL_VERSION, relayPayloadCaps } from "@langwatch/agent-contract";
import type { ConnectUpgradeRouter, UpgradeHandler } from "@langwatch/api";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { createConnectedAgentFixture } from "../../__tests__/connected-agent.fixture.ts";
import { detectResultCapViolation } from "../../rules/connected-agent-caps.rules.ts";
import { UNREADABLE_RESULT_MESSAGE } from "../../rules/connected-agent-frame.rules.ts";
import type { AgentService } from "../../services/agent.service.ts";
import type { ConnectedAgentCredentials } from "../../services/connected-agent-credential.service.ts";
import { ConnectedAgentRuntimeService } from "../../services/connected-agent-runtime.service.ts";
import { AgentSessionService } from "../../services/connected-agent-session.service.ts";
import { CONNECT_PATH } from "../agent-connect.ws.ts";
import { ConnectGatewayFixture } from "./agent-connect-gateway.fixture.ts";

function frameText(raw: WebSocket.RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

/** The minimal router a standalone `http.Server` needs, main's shape. */
function createUpgradeRouter(server: Server): ConnectUpgradeRouter {
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

const fakeAgents = createConnectedAgentFixture();
const fakeCredentials: ConnectedAgentCredentials = {
  resolve: async () => {
    throw new Error("Credential lookup is not configured for this test");
  },
};

describe("detectResultCapViolation", () => {
  const caps = relayPayloadCaps(1);

  describe("when the output is above the result cap", () => {
    /** @scenario "A result above the result cap is refused" */
    it("names the result cap", () => {
      const output = "x".repeat(caps.resultBytes + 10);
      expect(detectResultCapViolation({ output, session: undefined, caps })).toEqual({
        what: "result",
        sizeBytes: expect.any(Number),
        limitBytes: caps.resultBytes,
      });
      expect(detectResultCapViolation({ output: "small", session: undefined, caps })).toBeNull();
    });
  });

  describe("when the session is above the session cap", () => {
    /** @scenario "A session above the session cap is refused" */
    it("names the session cap", () => {
      const session = { token: "y".repeat(caps.sessionBytes + 10) };
      expect(detectResultCapViolation({ output: "ok", session, caps })).toEqual({
        what: "session",
        sizeBytes: expect.any(Number),
        limitBytes: caps.sessionBytes,
      });
      expect(detectResultCapViolation({ output: "ok", session: { id: "s1" }, caps })).toBeNull();
    });
  });
});

describe("ConnectGateway without Redis", () => {
  let server: Server;
  let gateway: ConnectGatewayFixture;
  let url: string;

  beforeAll(async () => {
    const runtime = ConnectedAgentRuntimeService.create({
      podId: "pod_solo",
      store: SessionStateStoreFactory.memory(),
    });
    server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    gateway = ConnectGatewayFixture.create({
      runtime,
      // Never reached: the replica check refuses before any credential read.
      agents: fakeAgents,
      credentials: fakeCredentials,
      publicBaseUrl: "https://example.test",
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
        socket.once("message", (raw) => resolve(JSON.parse(frameText(raw))));
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
  return createConnectedAgentFixture();
}

const resolvingCredentials: ConnectedAgentCredentials = {
  resolve: async () => ({
    project: { id: "proj_1", slug: "proj-one" },
    principalId: "key:test",
    userId: null,
  }),
};

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
    agents: [
      { name: overrides.name ?? "support-agent", environment: "production", parameters: {} },
    ],
  };
}

/** One pod with a real socket server, a real gateway, and a registering process. */
async function startPod({
  pingIntervalMs = 10_000,
  pongWaitMs = 200,
}: { pingIntervalMs?: number; pongWaitMs?: number } = {}) {
  const runtime = ConnectedAgentRuntimeService.create({
    podId: `pod_${Math.random().toString(36).slice(2)}`,
    store: SessionStateStoreFactory.memory(),
  });
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const gateway = ConnectGatewayFixture.create({
    runtime,
    agents: registeringAgentService(),
    credentials: resolvingCredentials,
    publicBaseUrl: "https://example.test",
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
  { autoPong = true }: { autoPong?: boolean } = {},
): { socket: WebSocket; registered: Promise<Record<string, unknown>> } {
  const socket = new WebSocket(`${url}${CONNECT_PATH}`, {
    headers: { Authorization: "Bearer sk-lw-anything" },
    autoPong,
  });
  const registered = new Promise<Record<string, unknown>>((resolve, reject) => {
    socket.once("open", () => socket.send(JSON.stringify(frame)));
    socket.once("message", (raw) => resolve(JSON.parse(frameText(raw))));
    socket.once("error", reject);
  });
  return { socket, registered };
}

describe("ConnectGateway socket lifecycle", () => {
  let pod: Awaited<ReturnType<typeof startPod>>;

  afterEach(async () => {
    if (pod) await stopPod(pod);
  });

  it("retires registration and closes the socket when subscribing to the instance fails", async () => {
    pod = await startPod();
    const registration = vi.spyOn(pod.runtime.registry, "register");
    vi.spyOn(pod.runtime.store, "subscribe").mockRejectedValue(
      new Error("Redis subscription failed"),
    );
    const { socket, registered } = connectAndRegister(pod.url, registerFrame());
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

    await expect(registered).resolves.toMatchObject({ type: "refused" });
    await closed;
    expect(pod.gateway.sessionCount).toBe(0);
    const registrationInput = registration.mock.calls[0]?.[0];
    expect(registrationInput?.agentIds).toHaveLength(1);
    for (const agentId of registrationInput?.agentIds ?? []) {
      await expect(
        pod.runtime.registry.listLive({ projectId: "proj_1", agentId }),
      ).resolves.toEqual([]);
    }
  });

  describe("when the instance does not answer a ping inside the pong wait", () => {
    /** @scenario "A missed pong retires the instance" */
    it("closes the socket and the instance is no longer live", async () => {
      pod = await startPod({ pingIntervalMs: 30, pongWaitMs: 30 });
      const { socket, registered } = connectAndRegister(pod.url, registerFrame(), {
        autoPong: false,
      });
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
      const slowAgents = createConnectedAgentFixture({
        registerConnected: async (input: Parameters<AgentService["registerConnected"]>[0]) => {
          await gate;
          return createConnectedAgentFixture().registerConnected(input);
        },
      });

      const runtime = ConnectedAgentRuntimeService.create({
        podId: "pod_slow",
        store: SessionStateStoreFactory.memory(),
      });
      const server = createServer((_request, response) => {
        response.statusCode = 404;
        response.end();
      });
      const gateway = ConnectGatewayFixture.create({
        runtime,
        agents: slowAgents,
        credentials: resolvingCredentials,
        publicBaseUrl: "https://example.test",
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

/** One platform frame off the socket, however ws delivered its bytes. */
function frameOf(raw: WebSocket.RawData): Record<string, unknown> {
  if (Array.isArray(raw)) return JSON.parse(Buffer.concat(raw).toString("utf8"));
  const bytes = raw instanceof ArrayBuffer ? Buffer.from(raw) : raw;
  return JSON.parse(bytes.toString("utf8"));
}

/** One registered instance on a started pod, and a call dispatched at its agent. */
async function dispatchToRegisteredInstance(pod: Awaited<ReturnType<typeof startPod>>) {
  await pod.runtime.dispatcher.start();
  const { socket, registered } = connectAndRegister(pod.url, registerFrame());
  const frames: Record<string, unknown>[] = [];
  const registeredFrame = await registered;
  socket.on("message", (raw) => frames.push(frameOf(raw)));
  const agents = registeredFrame.agents as { id: string }[];
  const pending = pod.runtime.dispatcher.dispatch({
    projectId: "proj_1",
    agent: {
      id: agents[0]?.id ?? "",
      name: "support-agent",
      environment: "production",
      timeoutMs: 20_000,
      isSticky: false,
    },
    call: {
      threadId: "thread_1",
      messages: [{ role: "user", content: "where is my order?" }],
      newMessages: [{ role: "user", content: "where is my order?" }],
      params: {},
      session: undefined,
      traceparent: null,
      run: {},
    },
  });
  await vi.waitFor(() => expect(frames.some((frame) => frame.type === "call")).toBe(true));
  const callId = String(frames.find((frame) => frame.type === "call")?.callId);
  const send = (frame: Record<string, unknown>) =>
    socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, ...frame }));
  send({ type: "ack", callId });
  return { socket, pending, callId, send };
}

describe("ConnectGateway result frames", () => {
  let pod: Awaited<ReturnType<typeof startPod>>;

  afterEach(async () => {
    await pod.runtime.dispatcher.close();
    await stopPod(pod);
  });

  describe("when the instance answers with a result the platform cannot read", () => {
    /** @scenario "A result the platform cannot read fails the call at once" */
    it("fails the call with agent_call_failed naming the field, before the deadline", async () => {
      pod = await startPod();
      const { socket, pending, callId, send } = await dispatchToRegisteredInstance(pod);
      const started = Date.now();

      send({
        type: "result",
        callId,
        output: { output: "Order 42 ships today", thread_id: "t1", order_number: null },
      });

      await expect(pending).rejects.toMatchObject({
        code: "agent_call_failed",
        meta: {
          remoteCode: "agent_call_failed",
          message: expect.stringMatching(
            new RegExp(`^${UNREADABLE_RESULT_MESSAGE}: output\\.role: `),
          ),
        },
      });
      expect(Date.now() - started).toBeLessThan(5_000);
      socket.close();
    });
  });

  describe("when an unreadable result names a call the instance does not hold", () => {
    /** @scenario "An unreadable result for a call the instance does not hold is dropped" */
    it("leaves the held call waiting for its real answer", async () => {
      pod = await startPod();
      const { socket, pending, callId, send } = await dispatchToRegisteredInstance(pod);

      send({ type: "result", callId: "call_nobody_asked_for", output: { output: "stray" } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      send({ type: "result", callId, output: "the real answer" });

      await expect(pending).resolves.toMatchObject({ output: "the real answer" });
      socket.close();
    });
  });
});

describe("AgentSessionService.findCallForSession", () => {
  describe("given an instance that registered agent A only, and a call routed at it for agent B", () => {
    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("is not handed the call and leaves its result unchanged", async () => {
      const store = SessionStateStoreFactory.memory();
      const runtime = ConnectedAgentRuntimeService.create({ podId: "pod_solo", store });
      const core = AgentSessionService.create({
        runtime,
        agents: registeringAgentService(),
        credentials: resolvingCredentials,
        publicBaseUrl: "https://example.test",
        replicaCount: 1,
      });
      const session = {
        instanceId: "inst_1",
        projectId: "proj_1",
        principalId: "key:test",
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

      const call = await core.findCallForSession(session, "call_1");

      expect(call).toBeNull();
      const result = await store.tryGet("agent_result:v1:proj_1:call_1");
      expect(result).toBeNull();
    });
  });
});
