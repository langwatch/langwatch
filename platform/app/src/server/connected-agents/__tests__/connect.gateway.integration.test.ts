/**
 * @vitest-environment node
 *
 * The connected agent gateway end to end: two app replicas that share one
 * Redis, an SDK socket on replica A, a relay dispatch from replica B, and
 * the credential refusals at the door. Real Postgres, real Redis, a real
 * `ws` client, nothing faked.
 *
 * @see specs/agents/connected-agents.feature
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generate } from "@langwatch/ksuid";
import {
  type RedisConnection,
  RedisConnectionService,
} from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { LANGY_SESSION_API_KEY_NAME } from "~/server/api-key/reserved-names";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { createUpgradeRouter } from "~/server/websockets/upgrade-router";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { CONNECT_PATH, ConnectGateway } from "../connect.gateway";
import { PRESENCE_TTL_SECONDS } from "../constants";
import { instanceChannel, instanceSetKey } from "../keys";
import { touchAgentLastSeen } from "../presence.projection";
import { PROTOCOL_VERSION, type RegisterFrame } from "../protocol";
import {
  type ConnectedAgentRuntime,
  createConnectedAgentRuntime,
} from "../runtime";
import { type AgentStateStore, createRedisStateStore } from "../state-store";

const ns = `connected-${nanoid(8)}`;

let connection: RedisConnection;
let organization: Organization;
let team: Team;
let projectId: string;
let projectApiKey: string;
let userId: string;
let personalToken: string;
let viewerToken: string;
let ingestToken: string;
let langyToken: string;
let orgWideToken: string;

type Pod = {
  runtime: ConnectedAgentRuntime;
  gateway: ConnectGateway;
  server: Server;
  url: string;
};
let podA: Pod;
let podB: Pod;

async function startPod({
  podId,
  store,
  pingIntervalMs = 200,
  pongWaitMs = 150,
}: {
  podId: string;
  store?: AgentStateStore;
  pingIntervalMs?: number;
  pongWaitMs?: number;
}): Promise<Pod> {
  const runtime = createConnectedAgentRuntime({
    podId,
    store: store ?? createRedisStateStore(connection),
    firstTurnGraceMs: 1_000,
    firstTurnPollMs: 50,
    resultPollMs: 100,
  });
  await runtime.dispatcher.start();
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const router = createUpgradeRouter(server);
  const gateway = new ConnectGateway({
    runtime,
    prisma,
    replicaCount: 2,
    pingIntervalMs,
    pongWaitMs,
  });
  gateway.mount(router);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { runtime, gateway, server, url: `ws://127.0.0.1:${port}` };
}

async function stopPod(pod: Pod): Promise<void> {
  await pod.gateway.close();
  await pod.runtime.dispatcher.close();
  await pod.runtime.store.close();
  await new Promise<void>((resolve) => pod.server.close(() => resolve()));
}

type Frame = Record<string, unknown> & { type: string };

/** A minimal SDK: one socket, frames as they arrive, a way to answer. */
class FakeSdk {
  readonly frames: Frame[] = [];
  private readonly waiters: ((frame: Frame) => void)[] = [];
  readonly socket: WebSocket;

  constructor({
    url,
    token,
    headers = {},
  }: {
    url: string;
    token: string;
    headers?: Record<string, string>;
  }) {
    this.socket = new WebSocket(`${url}${CONNECT_PATH}`, {
      headers: { Authorization: `Bearer ${token}`, ...headers },
    });
    this.socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      this.frames.push(frame);
      for (const waiter of this.waiters.splice(0)) waiter(frame);
    });
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
      this.socket.once("unexpected-response", (_request, response) =>
        reject(new Error(`upgrade answered ${response.statusCode}`)),
      );
    });
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ protocol: PROTOCOL_VERSION, ...frame }));
  }

  /** The next frame of a type, from what arrived or what will arrive. */
  next(type: string, timeoutMs = 5_000): Promise<Frame> {
    const seen = this.frames.find((frame) => frame.type === type);
    if (seen) {
      this.frames.splice(this.frames.indexOf(seen), 1);
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no ${type} frame inside ${timeoutMs}ms`)),
        timeoutMs,
      );
      const waiter = (frame: Frame) => {
        if (frame.type !== type) {
          this.waiters.push(waiter);
          return;
        }
        clearTimeout(timer);
        this.frames.splice(this.frames.indexOf(frame), 1);
        resolve(frame);
      };
      this.waiters.push(waiter);
    });
  }

  register(overrides: Partial<RegisterFrame> = {}): void {
    this.send({
      type: "register",
      sdk: { name: "langwatch", version: "1.0.0", language: "python" },
      instance: {
        id: `inst_${nanoid(6)}`,
        hostname: "laptop",
        username: "dev",
        pid: 4242,
        startedAt: new Date().toISOString(),
        inFlightCallIds: [],
      },
      agents: [
        {
          name: "support-agent",
          environment: "production",
          description: "Answers support questions",
          parameters: {
            type: "object",
            properties: { model: { type: "string", default: "gpt-5-mini" } },
          },
        },
      ],
      ...overrides,
    });
  }

  close(): void {
    this.socket.close();
  }

  closed(): Promise<{ code: number }> {
    return new Promise((resolve) =>
      this.socket.once("close", (code) => resolve({ code })),
    );
  }
}

async function connectAndRegister({
  pod,
  token,
  overrides = {},
}: {
  pod: Pod;
  token: string;
  overrides?: Partial<RegisterFrame>;
}): Promise<{ sdk: FakeSdk; registered: Frame; agentId: string }> {
  const sdk = new FakeSdk({
    url: pod.url,
    token,
    headers: { "X-Project-Id": projectId },
  });
  await sdk.open();
  sdk.register(overrides);
  const registered = await sdk.next("registered");
  const agents = registered.agents as { id: string }[];
  return { sdk, registered, agentId: agents[0]!.id };
}

async function refusalOf({
  pod,
  token,
  headers = { "X-Project-Id": projectId },
}: {
  pod: Pod;
  token: string;
  headers?: Record<string, string>;
}): Promise<Frame> {
  const sdk = new FakeSdk({ url: pod.url, token, headers });
  await sdk.open();
  const refused = await sdk.next("refused");
  await sdk.closed();
  return refused;
}

beforeAll(async () => {
  connection = new RedisConnectionService().connect({
    url: process.env.REDIS_URL,
    clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: process.env.REDIS_DB_INDEX,
  })!;
  if (!connection) throw new Error("These tests need a real Redis");
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({ redis: connection });

  organization = await prisma.organization.create({
    data: { name: "Connected Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Connected Team",
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const user = await prisma.user.create({
    data: { name: "Rogerio", email: `owner-${ns}@example.com` },
  });
  userId = user.id;
  await prisma.organizationUser.create({
    data: {
      userId,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });
  await prisma.teamUser.create({
    data: { userId, teamId: team.id, role: TeamUserRole.ADMIN },
  });
  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });
  projectApiKey = `sk-lw-${nanoid(48)}`;
  const project = await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Connected Project",
      slug: `--test-project-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: projectApiKey,
      teamId: team.id,
    },
  });
  projectId = project.id;
  // A second project the org-wide key can reach, so it must name one.
  await prisma.project.create({
    data: {
      id: `project_${nanoid()}`,
      name: "Other Project",
      slug: `--test-project-other-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: `sk-lw-${nanoid(48)}`,
      teamId: team.id,
    },
  });

  const apiKeys = ApiKeyService.create(prisma);
  const orgAdmin = {
    role: TeamUserRole.ADMIN,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: organization.id,
  };
  personalToken = (
    await apiKeys.create({
      name: `personal-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdmin],
    })
  ).token;
  orgWideToken = (
    await apiKeys.create({
      name: `service-${ns}`,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdmin],
    })
  ).token;
  viewerToken = (
    await apiKeys.create({
      name: `viewer-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [{ ...orgAdmin, role: TeamUserRole.VIEWER }],
    })
  ).token;
  ingestToken = (
    await apiKeys.create({
      name: `ingest-${ns}`,
      organizationId: organization.id,
      permissionMode: "all",
      ingestSourceType: "claude-code",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.PROJECT,
          scopeId: projectId,
        },
      ],
    })
  ).token;
  langyToken = (
    await apiKeys.create({
      name: LANGY_SESSION_API_KEY_NAME,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [orgAdmin],
      isSystemManaged: true,
    })
  ).token;

  podA = await startPod({ podId: "pod_a" });
  podB = await startPod({ podId: "pod_b" });
});

afterAll(async () => {
  await stopPod(podA);
  await stopPod(podB);
  await cleanupTestRows(prisma, [
    ["agent", { projectId }],
    ["roleBinding", { organizationId: organization.id }],
    ["apiKey", { organizationId: organization.id }],
    ["project", { teamId: team.id }],
    ["teamUser", { teamId: team.id }],
    ["team", { id: team.id }],
    ["organizationUser", { organizationId: organization.id }],
    ["organization", { id: organization.id }],
    ["user", { id: userId }],
  ]);
  await resetApp();
  connection.disconnect();
});

describe("register", () => {
  describe("when a process registers an agent", () => {
    /** @scenario "A register frame creates one row per agent name and environment" */
    it("creates the row and answers with its id and url", async () => {
      const { sdk, registered, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const row = await prisma.agent.findFirst({
        where: { id: agentId, projectId },
      });

      expect(row).toMatchObject({
        type: "connected",
        name: "support-agent",
        environment: "production",
        identityKey: "support-agent@production",
        ownerUserId: null,
        hostLabel: null,
      });
      expect(registered.agents).toEqual([
        expect.objectContaining({
          id: agentId,
          name: "support-agent",
          environment: "production",
          url: expect.stringContaining(agentId),
          parameterNotes: [],
        }),
      ]);
      sdk.close();
      await sdk.closed();
    });
  });
});

describe("presence", () => {
  describe("when one instance is connected", () => {
    /** @scenario "An agent is online while one instance is connected" */
    it("lists the instance with its hostname and pid", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const live = await podB.runtime.registry.listLive({ projectId, agentId });

      expect(live).toEqual([
        expect.objectContaining({
          hostname: "laptop",
          pid: 4242,
          podId: "pod_a",
        }),
      ]);
      sdk.close();
      await sdk.closed();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        await podB.runtime.registry.listLive({ projectId, agentId }),
      ).toEqual([]);
    });
  });

  describe("when the last refresh is older than the TTL", () => {
    /** @scenario "An agent goes offline after the presence TTL" */
    it("reads as offline", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const later = Date.now() + (PRESENCE_TTL_SECONDS + 1) * 1000;
      expect(
        await podB.runtime.registry.listLive({
          projectId,
          agentId,
          now: later,
        }),
      ).toEqual([]);
      expect(await connection.zcard(instanceSetKey(projectId, agentId))).toBe(
        0,
      );
      sdk.close();
      await sdk.closed();
    });
  });

  describe("when presence is refreshed twice inside a minute", () => {
    /** @scenario "The last seen time is written at most once a minute" */
    it("writes the row once, and again after the minute", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const base = Date.now() + 10 * 60 * 1000;
      expect(
        await touchAgentLastSeen({ prisma, projectId, agentId, now: base }),
      ).toBe(true);
      expect(
        await touchAgentLastSeen({
          prisma,
          projectId,
          agentId,
          now: base + 30_000,
        }),
      ).toBe(false);
      expect(
        await touchAgentLastSeen({
          prisma,
          projectId,
          agentId,
          now: base + 61_000,
        }),
      ).toBe(true);
      const row = await prisma.agent.findFirst({
        where: { id: agentId, projectId },
      });
      expect(row?.lastSeenAt?.getTime()).toBe(base + 61_000);
      sdk.close();
      await sdk.closed();
    });
  });

  describe("when a pong lands after the next ping went out", () => {
    /** @scenario "A pong that lands inside its own wait keeps the socket" */
    it("keeps the socket open while the pong is inside its own wait", async () => {
      const pod = await startPod({
        podId: "pod_slow_pong",
        pingIntervalMs: 100,
        pongWaitMs: 1_000,
      });
      const { sdk } = await connectAndRegister({ pod, token: projectApiKey });

      // `ws` answers a ping the moment it reads one, so pausing the socket
      // holds every pong past the next ping and still inside the first
      // ping's own wait.
      sdk.socket.pause();
      await new Promise((resolve) => setTimeout(resolve, 300));
      sdk.socket.resume();
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(sdk.socket.readyState).toBe(WebSocket.OPEN);
      expect(pod.gateway.sessionCount).toBe(1);
      sdk.close();
      await sdk.closed();
      await stopPod(pod);
    });
  });

  describe("when the socket goes away while the registration is running", () => {
    /** @scenario "A socket that goes away during registration retires its instance" */
    it("holds no session and retires the instance", async () => {
      let enterSubscribe: () => void = () => undefined;
      const subscribing = new Promise<void>((resolve) => {
        enterSubscribe = resolve;
      });
      let releaseSubscribe: () => void = () => undefined;
      const subscribeGate = new Promise<void>((resolve) => {
        releaseSubscribe = resolve;
      });
      const store = createRedisStateStore(connection);
      const instanceId = `inst_${nanoid(6)}`;
      const pod = await startPod({
        podId: "pod_gated",
        store: {
          ...store,
          subscribe: async (channel, listener) => {
            if (channel !== instanceChannel(instanceId)) {
              return store.subscribe(channel, listener);
            }
            enterSubscribe();
            await subscribeGate;
            return store.subscribe(channel, listener);
          },
        },
      });
      const agentName = `gated-agent-${nanoid(6)}`;
      const sdk = new FakeSdk({
        url: pod.url,
        token: projectApiKey,
        headers: { "X-Project-Id": projectId },
      });
      await sdk.open();
      sdk.register({
        instance: {
          id: instanceId,
          hostname: "laptop",
          username: "dev",
          pid: 4242,
          startedAt: new Date().toISOString(),
          inFlightCallIds: [],
        },
        agents: [
          { name: agentName, environment: "production", parameters: {} },
        ],
      });

      await subscribing;
      sdk.socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 100));
      releaseSubscribe();
      await new Promise((resolve) => setTimeout(resolve, 200));

      const row = await prisma.agent.findFirst({
        where: { projectId, name: agentName },
      });
      expect(pod.gateway.sessionCount).toBe(0);
      expect(
        await podB.runtime.registry.listLive({ projectId, agentId: row!.id }),
      ).toEqual([]);
      await stopPod(pod);
    });
  });

  describe("when the instance answers no ping", () => {
    /** @scenario "A missed pong retires the instance" */
    it("closes the socket and retires the instance", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      // `ws` answers pings by itself; pausing the socket stops the pong.
      sdk.socket.pause();
      await new Promise((resolve) => setTimeout(resolve, 800));
      sdk.socket.resume();
      await sdk.closed();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        await podB.runtime.registry.listLive({ projectId, agentId }),
      ).toEqual([]);
    });
  });
});

describe("dispatch across replicas", () => {
  describe("when the instance is on replica A and the call comes from B", () => {
    /** @scenario "A call reaches an instance connected to another app replica" */
    it("delivers the call frame and returns the result", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const answering = (async () => {
        const call = await sdk.next("call");
        sdk.send({ type: "ack", callId: call.callId });
        sdk.send({
          type: "result",
          callId: call.callId,
          output: `echo: ${(call.messages as { content: string }[])[0]!.content}`,
          session: { turn: 1 },
        });
        return call;
      })();

      const outcome = await podB.runtime.dispatcher.dispatch({
        projectId,
        agent: {
          id: agentId,
          name: "support-agent",
          environment: "production",
          timeoutMs: 5_000,
          isSticky: false,
        },
        call: {
          threadId: "thread_1",
          messages: [{ role: "user", content: "hello" }],
          newMessages: [{ role: "user", content: "hello" }],
          params: { model: "gpt-5-mini" },
          session: undefined,
          traceparent:
            "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          run: { scenarioRunId: "run_1" },
        },
      });
      const call = await answering;

      expect(outcome.output).toBe("echo: hello");
      expect(outcome.session).toEqual({ turn: 1 });
      expect(outcome.instance.hostname).toBe("laptop");
      expect(Object.keys(call).sort()).toEqual(
        [
          "type",
          "protocol",
          "callId",
          "agentId",
          "threadId",
          "messages",
          "newMessages",
          "params",
          "session",
          "traceparent",
          "deadlineAt",
          "run",
        ].sort(),
      );
      sdk.close();
      await sdk.closed();
    });
  });

  describe("when the relay request is aborted", () => {
    /** @scenario "Aborting the relay request cancels the call on the instance" */
    it("sends a cancel frame for that call", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const controller = new AbortController();
      const pending = podB.runtime.dispatcher.dispatch({
        projectId,
        agent: {
          id: agentId,
          name: "support-agent",
          environment: "production",
          timeoutMs: 5_000,
          isSticky: false,
        },
        call: {
          threadId: "thread_abort",
          messages: [{ role: "user", content: "slow" }],
          newMessages: [{ role: "user", content: "slow" }],
          params: {},
          session: undefined,
          traceparent: null,
          run: {},
        },
        signal: controller.signal,
      });
      const call = await sdk.next("call");
      sdk.send({ type: "ack", callId: call.callId });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      const cancel = await sdk.next("cancel");
      expect(cancel.callId).toBe(call.callId);
      sdk.close();
      await sdk.closed();
    });
  });

  describe("when the instance disconnects mid-call", () => {
    it("fails the call with agent_disconnected at once", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
      });
      const pending = podB.runtime.dispatcher.dispatch({
        projectId,
        agent: {
          id: agentId,
          name: "support-agent",
          environment: "production",
          timeoutMs: 20_000,
          isSticky: false,
        },
        call: {
          threadId: "thread_gone",
          messages: [{ role: "user", content: "hi" }],
          newMessages: [{ role: "user", content: "hi" }],
          params: {},
          session: undefined,
          traceparent: null,
          run: {},
        },
      });
      const call = await sdk.next("call");
      sdk.send({ type: "ack", callId: call.callId });
      await new Promise((resolve) => setTimeout(resolve, 50));
      sdk.socket.terminate();

      const started = Date.now();
      await expect(pending).rejects.toMatchObject({
        code: "agent_disconnected",
      });
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });

  describe("when a call is routed at an instance that did not register the agent", () => {
    /** @scenario "An instance never receives a call for an agent it did not register" */
    it("does not send the call to it and picks another instance", async () => {
      const real = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
        overrides: {
          instance: {
            id: `inst_real_${nanoid(4)}`,
            hostname: "real-host",
            username: "dev",
            pid: 1,
            startedAt: new Date().toISOString(),
            inFlightCallIds: [],
            maxConcurrency: 1,
          },
        },
      });
      const stranger = await connectAndRegister({
        pod: podA,
        token: projectApiKey,
        overrides: {
          instance: {
            id: `inst_stranger_${nanoid(4)}`,
            hostname: "stranger-host",
            username: "dev",
            pid: 2,
            startedAt: new Date().toISOString(),
            inFlightCallIds: [],
            maxConcurrency: 8,
          },
          agents: [
            { name: "other-agent", environment: "production", parameters: {} },
          ],
        },
      });
      // Claim the stranger for the real agent in presence by hand, with the
      // most free slots so the dispatcher picks it first. The dispatcher
      // would never do this; the gateway's own check is what is tested.
      const [strangerLive] = await podB.runtime.registry.listLive({
        projectId,
        agentId: stranger.agentId,
      });
      await podB.runtime.registry.register({
        meta: strangerLive!,
        agentIds: [real.agentId, stranger.agentId],
      });
      const answering = (async () => {
        const call = await real.sdk.next("call");
        real.sdk.send({ type: "ack", callId: call.callId });
        real.sdk.send({ type: "result", callId: call.callId, output: "real" });
      })();

      const outcome = await podB.runtime.dispatcher.dispatch({
        projectId,
        agent: {
          id: real.agentId,
          name: "support-agent",
          environment: "production",
          timeoutMs: 5_000,
          isSticky: false,
        },
        call: {
          threadId: `thread_${nanoid(4)}`,
          messages: [{ role: "user", content: "hi" }],
          newMessages: [{ role: "user", content: "hi" }],
          params: {},
          session: undefined,
          traceparent: null,
          run: {},
        },
      });
      await answering;

      expect(outcome.output).toBe("real");
      expect(outcome.instance.hostname).toBe("real-host");
      expect(
        stranger.sdk.frames.filter((frame) => frame.type === "call"),
      ).toEqual([]);
      real.sdk.close();
      stranger.sdk.close();
      await Promise.all([real.sdk.closed(), stranger.sdk.closed()]);
    });
  });
});

describe("given a socket at the connect endpoint", () => {
  describe("when the key is an ingestion key", () => {
    /** @scenario "An ingestion key cannot connect" */
    it("refuses it with key_type_not_allowed", async () => {
      expect(await refusalOf({ pod: podA, token: ingestToken })).toMatchObject({
        code: "key_type_not_allowed",
      });
    });
  });

  describe("when the key is a Langy session key", () => {
    /** @scenario "A Langy session key cannot connect" */
    it("refuses it with key_type_not_allowed", async () => {
      expect(await refusalOf({ pod: podA, token: langyToken })).toMatchObject({
        code: "key_type_not_allowed",
      });
    });
  });

  describe("when the key cannot manage scenarios", () => {
    /** @scenario "A key without scenarios manage cannot connect" */
    it("refuses it with permission_denied", async () => {
      expect(await refusalOf({ pod: podA, token: viewerToken })).toMatchObject({
        code: "permission_denied",
      });
    });
  });

  describe("when an organization key names no project", () => {
    /** @scenario "A key that reaches several projects must name one" */
    it("refuses it and lists the projects it reaches", async () => {
      const refused = await refusalOf({
        pod: podA,
        token: orgWideToken,
        headers: {},
      });
      expect(refused.code).toBe("project_required");
      const projects = (
        refused.meta as { projects: { id: string; name: string }[] }
      ).projects;
      expect(projects.map((project) => project.id)).toContain(projectId);
    });
  });

  describe("when the token names no key at all", () => {
    /** @scenario "An invalid key cannot connect" */
    it("refuses it with api_key_invalid", async () => {
      expect(
        await refusalOf({ pod: podA, token: `sk-lw-${nanoid(48)}` }),
      ).toMatchObject({
        code: "api_key_invalid",
      });
    });
  });

  describe("when the key is personal and the agent is a development one", () => {
    it("accepts it and scopes the agent to its owner", async () => {
      const { sdk, agentId } = await connectAndRegister({
        pod: podA,
        token: personalToken,
        overrides: {
          agents: [
            { name: "dev-agent", environment: "development", parameters: {} },
          ],
        },
      });
      const row = await prisma.agent.findFirst({
        where: { id: agentId, projectId },
      });
      expect(row).toMatchObject({
        environment: "development",
        ownerUserId: userId,
        identityKey: `dev-agent@development/user:${userId}`,
      });
      sdk.close();
      await sdk.closed();
    });
  });
});
