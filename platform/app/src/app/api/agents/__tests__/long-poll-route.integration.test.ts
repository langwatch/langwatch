/**
 * @vitest-environment node
 *
 * The HTTP long-poll transport end to end: two app replicas sharing one
 * Redis, a process registering on replica A over HTTP, polls landing on
 * either replica, a relay dispatch from replica B, and the credential
 * refusals at the door. Real Postgres, real Redis, the real Hono routes.
 *
 * @see specs/agents/connected-agents.feature
 */

import { generate } from "@langwatch/ksuid";
import {
  type RedisConnection,
  RedisConnectionService,
} from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PRESENCE_TTL_SECONDS,
  relayPayloadCaps,
} from "~/server/connected-agents/constants";
import { LongPollTransport } from "~/server/connected-agents/long-poll.transport";
import {
  PROTOCOL_VERSION,
  type RegisterFrame,
} from "~/server/connected-agents/protocol";
import {
  type ConnectedAgentRuntime,
  createConnectedAgentRuntime,
} from "~/server/connected-agents/runtime";
import { createRedisStateStore } from "~/server/connected-agents/state-store";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { createAgentsApp } from "../[[...route]]/app";

const ns = `longpoll-${nanoid(8)}`;

let connection: RedisConnection | null = null;
let isSetupComplete = false;
let organization: Organization;
let team: Team;
let projectId: string;
let projectApiKey: string;
let userId: string;
let viewerToken: string;
let ingestToken: string;

type Pod = {
  runtime: ConnectedAgentRuntime;
  transport: LongPollTransport;
  app: ReturnType<typeof createAgentsApp>;
};
let podA: Pod;
let podB: Pod;

const POLL_WAIT_MS = 300;

async function startPod({
  podId,
  redis,
}: {
  podId: string;
  redis: RedisConnection;
}): Promise<Pod> {
  const runtime = createConnectedAgentRuntime({
    podId,
    store: createRedisStateStore(redis),
    firstTurnGraceMs: 1_000,
    firstTurnPollMs: 50,
    resultPollMs: 100,
  });
  await runtime.dispatcher.start();
  const transport = new LongPollTransport({
    runtime,
    prisma,
    replicaCount: 2,
    pollWaitMs: POLL_WAIT_MS,
  });
  const app = createAgentsApp({ transport: () => transport });
  return { runtime, transport, app };
}

async function stopPod(pod: Pod): Promise<void> {
  await pod.transport.close();
  await pod.runtime.dispatcher.close();
  await pod.runtime.store.close();
}

type Json = Record<string, unknown>;

function registerFrame(overrides: Partial<RegisterFrame> = {}): Json {
  return {
    type: "register",
    protocol: PROTOCOL_VERSION,
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
  };
}

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${token}`,
    "X-Project-Id": projectId,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function register(
  pod: Pod,
  token: string,
  overrides: Partial<RegisterFrame> = {},
): Promise<{ status: number; body: Json }> {
  const response = await pod.app.request("/api/v1/agents/connect/register", {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(registerFrame(overrides)),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

/**
 * Registers an agent of its own for the test: one identity per test keeps
 * the presence sets apart, so a dispatch can only pick this instance.
 */
async function registered(pod: Pod) {
  const { status, body } = await register(pod, projectApiKey, {
    agents: [
      {
        name: `support-agent-${nanoid(6)}`,
        environment: "production",
        parameters: {},
      },
    ],
  });
  if (status !== 200) {
    throw new Error(`register answered ${status}: ${JSON.stringify(body)}`);
  }
  const frame = body.frame as { agents: { id: string }[]; instanceId: string };
  return {
    instanceToken: body.instanceToken as string,
    agentId: frame.agents[0]!.id,
    instanceId: frame.instanceId,
  };
}

async function poll(
  pod: Pod,
  instanceToken: string,
  { inFlight = [], signal }: { inFlight?: string[]; signal?: AbortSignal } = {},
): Promise<{ status: number; body: Json }> {
  const query = inFlight.length > 0 ? `?inFlight=${inFlight.join(",")}` : "";
  const response = await pod.app.request(
    `/api/v1/agents/connect/poll${query}`,
    {
      method: "GET",
      headers: headers(projectApiKey, {
        "X-Agent-Instance-Token": instanceToken,
      }),
      signal,
    },
  );
  return { status: response.status, body: (await response.json()) as Json };
}

async function postFrames(
  pod: Pod,
  instanceToken: string,
  frames: Json[],
): Promise<{ status: number; body: Json }> {
  const response = await pod.app.request("/api/v1/agents/connect/frames", {
    method: "POST",
    headers: headers(projectApiKey, {
      "X-Agent-Instance-Token": instanceToken,
    }),
    body: JSON.stringify({
      frames: frames.map((frame) => ({ protocol: PROTOCOL_VERSION, ...frame })),
    }),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

function dispatchFrom(
  pod: Pod,
  agentId: string,
  {
    threadId = `thread_${nanoid(4)}`,
    signal,
    timeoutMs = 5_000,
    now,
  }: {
    threadId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    now?: () => number;
  } = {},
) {
  return pod.runtime.dispatcher.dispatch({
    projectId,
    agent: {
      id: agentId,
      name: "support-agent",
      environment: "production",
      timeoutMs,
      isSticky: false,
    },
    call: {
      threadId,
      messages: [{ role: "user", content: "hello" }],
      newMessages: [{ role: "user", content: "hello" }],
      params: { model: "gpt-5-mini" },
      session: undefined,
      traceparent: null,
      run: { scenarioRunId: "run_1" },
    },
    signal,
    now,
  });
}

beforeAll(async () => {
  connection = new RedisConnectionService().connect({
    url: process.env.REDIS_URL,
    clusterEndpoints: process.env.REDIS_CLUSTER_ENDPOINTS,
    dbIndex: process.env.REDIS_DB_INDEX,
  });
  if (!connection) throw new Error("These tests need a real Redis");
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({ redis: connection });

  organization = await prisma.organization.create({
    data: { name: "Long Poll Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Long Poll Team",
      slug: `--test-team-${ns}`,
      organizationId: organization.id,
    },
  });
  const user = await prisma.user.create({
    data: { name: "Owner", email: `owner-${ns}@example.com` },
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
      name: "Long Poll Project",
      slug: `--test-project-${ns}`,
      language: "python",
      framework: "other",
      apiKey: projectApiKey,
      teamId: team.id,
    },
  });
  projectId = project.id;

  const apiKeys = ApiKeyService.create(prisma);
  const orgAdmin = {
    role: TeamUserRole.ADMIN,
    scopeType: RoleBindingScopeType.ORGANIZATION,
    scopeId: organization.id,
  };
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

  podA = await startPod({ podId: "pod_a", redis: connection });
  podB = await startPod({ podId: "pod_b", redis: connection });
  isSetupComplete = true;
});

afterAll(async () => {
  if (!isSetupComplete) {
    connection?.disconnect();
    return;
  }
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
  connection?.disconnect();
});

describe("register over HTTP", () => {
  describe("when a process posts a register frame", () => {
    /** @scenario "A register over HTTP creates the rows and answers with an instance token" */
    it("creates the row and answers with the registered frame and a token", async () => {
      const { status, body } = await register(podA, projectApiKey);
      const frame = body.frame as Json;

      expect(status).toBe(200);
      expect(frame.type).toBe("registered");
      expect(typeof body.instanceToken).toBe("string");
      const agents = frame.agents as { id: string; name: string }[];
      const row = await prisma.agent.findFirst({
        where: { id: agents[0]!.id, projectId },
      });
      expect(row).toMatchObject({
        type: "connected",
        name: "support-agent",
        environment: "production",
      });
    });
  });

  describe("when the credential cannot connect an agent", () => {
    /** @scenario "The HTTP transport refuses the same credentials as the socket" */
    it("answers a refused frame with the socket's reason", async () => {
      const viewer = await register(podA, viewerToken);
      expect(viewer.status).toBe(403);
      expect(viewer.body.frame).toMatchObject({
        type: "refused",
        code: "permission_denied",
      });

      const ingest = await register(podA, ingestToken);
      expect(ingest.status).toBe(403);
      expect(ingest.body.frame).toMatchObject({
        type: "refused",
        code: "key_type_not_allowed",
      });
    });
  });
});

describe("poll", () => {
  describe("when a call is dispatched while no poll waits", () => {
    /** @scenario "A poll delivers a parked call once" */
    /** @scenario "A result posted over HTTP answers the dispatcher" */
    it("hands the call to the next poll, once, and the posted result answers the dispatcher", async () => {
      const { instanceToken, agentId } = await registered(podA);
      const pending = dispatchFrom(podB, agentId);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const first = await poll(podB, instanceToken);
      const frames = first.body.frames as Json[];
      expect(first.status).toBe(200);
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        type: "call",
        protocol: PROTOCOL_VERSION,
        agentId,
      });
      const callId = frames[0]!.callId as string;

      const second = await poll(podA, instanceToken, { inFlight: [callId] });
      expect(second.body.frames).toEqual([]);

      const posted = await postFrames(podA, instanceToken, [
        { type: "ack", callId },
        { type: "result", callId, output: "echo: hello", session: { n: 1 } },
      ]);
      expect(posted.status).toBe(200);
      expect(posted.body).toEqual({ accepted: 2 });

      const outcome = await pending;
      expect(outcome.output).toBe("echo: hello");
      expect(outcome.session).toEqual({ n: 1 });
      expect(outcome.instance.hostname).toBe("laptop");
    });
  });

  describe("when the instance polls", () => {
    /** @scenario "A poll refreshes presence" */
    it("keeps the instance live until the presence TTL passes with no poll", async () => {
      const { instanceToken, agentId, instanceId } = await registered(podA);
      await poll(podB, instanceToken);

      const live = await podB.runtime.registry.listLive({ projectId, agentId });
      expect(live.map((instance) => instance.instanceId)).toContain(instanceId);

      const later = Date.now() + (PRESENCE_TTL_SECONDS + 1) * 1000;
      expect(
        await podB.runtime.registry.listLive({
          projectId,
          agentId,
          now: later,
        }),
      ).toEqual([]);
    });
  });

  describe("when the relay request is aborted after the ack", () => {
    /** @scenario "A cancel reaches a polling instance" */
    it("answers the next poll with a cancel frame", async () => {
      const { instanceToken, agentId } = await registered(podA);
      const controller = new AbortController();
      const pending = dispatchFrom(podB, agentId, {
        signal: controller.signal,
      });

      const first = await poll(podA, instanceToken);
      const callId = (first.body.frames as Json[])[0]!.callId as string;
      await postFrames(podA, instanceToken, [{ type: "ack", callId }]);

      const waiting = poll(podB, instanceToken, { inFlight: [callId] });
      await new Promise((resolve) => setTimeout(resolve, 50));
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });

      const next = await waiting;
      expect(next.body.frames).toEqual([
        { type: "cancel", protocol: PROTOCOL_VERSION, callId },
      ]);
    });
  });

  describe("when the token names no session", () => {
    /** @scenario "A poll with an unknown instance token asks the process to register again" */
    it("answers 410 with agent_session_unknown", async () => {
      const answer = await poll(podA, "ait_nobody_knows_this");
      expect(answer.status).toBe(410);
      expect(JSON.stringify(answer.body)).toContain("agent_session_unknown");
    });
  });

  describe("when the last poll is older than the presence TTL", () => {
    /** @scenario "A process that stops polling goes offline after the presence TTL" */
    it("fails a dispatch with agent_offline", async () => {
      const { agentId } = await registered(podA);
      const offset = (PRESENCE_TTL_SECONDS + 1) * 1000;

      await expect(
        dispatchFrom(podB, agentId, { now: () => Date.now() + offset }),
      ).rejects.toMatchObject({ code: "agent_offline" });
    });
  });
});

describe("frames", () => {
  describe("when the body carries no frame the endpoint takes", () => {
    /** @scenario "A frames body the endpoint does not take is refused as a protocol frame" */
    it("answers a refused frame with protocol_invalid", async () => {
      const { instanceToken } = await registered(podA);

      const response = await podA.app.request("/api/v1/agents/connect/frames", {
        method: "POST",
        headers: headers(projectApiKey, {
          "X-Agent-Instance-Token": instanceToken,
        }),
        body: JSON.stringify({ frames: [{ type: "register" }] }),
      });
      const body = (await response.json()) as Json;

      expect(response.status).toBe(422);
      expect(body.frame).toMatchObject({
        type: "refused",
        code: "protocol_invalid",
      });
    });
  });

  describe("when the body is above the frame cap", () => {
    /** @scenario "A frames body above the cap names the limit alone" */
    it("names the limit and no size, since nothing measured one", async () => {
      const capMb = 0.001;
      const limitBytes = relayPayloadCaps(capMb).frameBytes;
      process.env.LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB = String(capMb);
      try {
        const app = createAgentsApp({ transport: () => podA.transport });

        const response = await app.request("/api/v1/agents/connect/frames", {
          method: "POST",
          headers: headers(projectApiKey, {
            "X-Agent-Instance-Token": "ait_whatever",
          }),
          body: JSON.stringify({
            frames: [{ type: "ack", callId: "x".repeat(limitBytes) }],
          }),
        });
        const body = (await response.json()) as Json;

        expect(response.status).toBe(413);
        expect(body.meta).toEqual({ what: "result", limitBytes });
      } finally {
        delete process.env.LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB;
      }
    });
  });
});

describe("deregister over HTTP", () => {
  describe("when the process posts a deregister frame", () => {
    /** @scenario "A deregister posted over HTTP retires the instance at once" */
    it("retires the instance and forgets the token", async () => {
      const { instanceToken, agentId } = await registered(podA);
      await poll(podB, instanceToken);

      const posted = await postFrames(podB, instanceToken, [
        { type: "deregister" },
      ]);
      expect(posted.status).toBe(200);

      expect(
        await podA.runtime.registry.listLive({ projectId, agentId }),
      ).toEqual([]);
      const next = await poll(podA, instanceToken);
      expect(next.status).toBe(410);
    });
  });
});
