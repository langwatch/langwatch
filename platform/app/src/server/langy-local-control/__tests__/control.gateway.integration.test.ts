/**
 * @vitest-environment node
 *
 * The local control socket end to end: two app replicas over one Redis, a
 * real `ws` client standing in for `langwatch langy --share-control`, a call
 * dispatched from the replica that does NOT hold the socket, and the same
 * moves again over the long-poll transport. Real Postgres, real Redis, a real
 * minted session key, nothing faked but the conversation read and the turn
 * start.
 *
 * @see specs/langy/langy-local-control.feature
 * @see specs/langy/langy-local-permissions.feature
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { generate } from "@langwatch/ksuid";
import {
  type RedisConnection,
  RedisConnectionService,
} from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import WebSocket from "ws";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  type Team,
  TeamUserRole,
} from "~/generated/prisma/client";
import { ApiKeyService } from "~/server/api-key/api-key.service";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { LangyTurnInProgressError } from "~/server/app-layer/langy/errors";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type AgentStateStore,
  createRedisStateStore,
} from "~/server/connected-agents/state-store";
import { prisma } from "~/server/db";
import { createUpgradeRouter } from "~/server/websockets/upgrade-router";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";
import { CONTROL_CONNECT_PATH, LocalControlGateway } from "../control.gateway";
import { LocalControlLongPoll } from "../control.long-poll";
import { LOCAL_CONTROL_PROTOCOL_VERSION } from "../protocol";
import {
  createLocalControlRuntime,
  type LocalControlRuntime,
} from "../runtime";
import { LocalControlSessionCore } from "../session.core";

const ns = `local-control-${nanoid(8)}`;

let connection: RedisConnection;
let organization: Organization;
let team: Team;
let projectId: string;
let projectApiKey: string;
/** The developer's own key: a real credential, and the wrong kind here. */
let personalToken: string;
let userId: string;

/**
 * The conversation and turn one test shares a folder with. Fresh per test, so
 * a card or a call left pending by the test before cannot answer for this one.
 */
let conversationId = `conv_${nanoid(10)}`;
let turnId = `turn_${nanoid(10)}`;

/** What the injected conversation read answers, per test. */
let conversationRow: {
  id: string;
  title: string | null;
  currentTurnId: string | null;
  lastModel: string | null;
} | null;

/** Every turn the platform started because a folder connected. */
let startedTurns: { text: string; idempotencyKey: string }[] = [];
/** What the next turn start does, so the busy-turn case is a real refusal. */
let turnStartOutcome: "ok" | "in_progress" = "ok";

/** Every durable event the core and the wait service dispatched. */
let events: { name: string; data: Record<string, unknown> }[] = [];
/** Every live stream entry the cards wrote. */
let liveEntries: { kind: string; payload: Record<string, unknown> }[] = [];

/** Whether the conversation's model may skip the permission cards. */
let skipAllowed = false;

type Pod = {
  runtime: LocalControlRuntime;
  core: LocalControlSessionCore;
  gateway: LocalControlGateway;
  longPoll: LocalControlLongPoll;
  server: Server;
  url: string;
};

let podA: Pod;
let podB: Pod;

function testPorts(store: AgentStateStore) {
  const runtime = createLocalControlRuntime({
    store,
    prisma,
    offlineWaitMs: 200,
    pollIntervalMs: 25,
    events: {
      async startUserWait(data) {
        events.push({ name: "user_wait_started", data });
      },
      async endUserWait(data) {
        events.push({ name: "user_wait_ended", data });
      },
    },
    buffer: {
      async appendLocalPermission({ entry }) {
        liveEntries.push({ kind: "local_permission", payload: entry });
      },
      async appendQuestion({ entry }) {
        liveEntries.push({ kind: "question", payload: entry });
      },
      async appendStatus({ status }) {
        liveEntries.push({ kind: "status", payload: { status } });
      },
    },
  });
  const core = new LocalControlSessionCore({
    prisma,
    store,
    presence: runtime.presence,
    dispatcher: runtime.dispatcher,
    waits: runtime.waits,
    requests: runtime.requests,
    conversations: {
      async findByIdVisible() {
        return conversationRow;
      },
    },
    events: {
      async connectLocalWorkspace(data) {
        events.push({ name: "local_workspace_connected", data });
      },
      async disconnectLocalWorkspace(data) {
        events.push({ name: "local_workspace_disconnected", data });
      },
    },
    buffer: {
      async appendLocalWorkspace({ entry }) {
        liveEntries.push({ kind: "local_workspace", payload: entry });
      },
    },
    skipGate: async () => ({ allowed: skipAllowed }),
    turns: {
      async start({ text, idempotencyKey }) {
        if (turnStartOutcome === "in_progress") {
          throw new LangyTurnInProgressError();
        }
        startedTurns.push({ text, idempotencyKey });
      },
    },
  });
  return { runtime, core };
}

async function startPod(): Promise<Pod> {
  const { runtime, core } = testPorts(createRedisStateStore(connection));
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const router = createUpgradeRouter(server);
  const gateway = new LocalControlGateway({
    core,
    pingIntervalMs: 200,
    pongWaitMs: 150,
  });
  gateway.mount(router);
  const longPoll = new LocalControlLongPoll({
    core,
    holdMs: 300,
    pollIntervalMs: 25,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    runtime,
    core,
    gateway,
    longPoll,
    server,
    url: `ws://127.0.0.1:${port}`,
  };
}

async function stopPod(pod: Pod): Promise<void> {
  await pod.gateway.close();
  await pod.longPoll.close();
  await pod.runtime.store.close();
  await new Promise<void>((resolve) => pod.server.close(() => resolve()));
}

type Frame = Record<string, unknown> & { type: string };

/** The environment checklist the command line sends with its register frame. */
function workspaceInfo() {
  return {
    root: "/Users/dev/acme-app",
    name: "acme-app",
    gitBranch: "main",
    gitRemote: "git@github.com:acme/acme-app.git",
    gitDirty: false,
    os: "darwin",
    nodeVersion: "24.11.1",
    pythonVersion: "3.12.4",
    ghAuthenticated: true,
    packageManager: "pnpm",
  };
}

/** A minimal `langwatch langy --share-control`: one socket, frames both ways. */
class FakeCli {
  readonly frames: Frame[] = [];
  private readonly waiters: ((frame: Frame) => void)[] = [];
  readonly socket: WebSocket;

  constructor({
    url,
    token,
    instanceId,
  }: {
    url: string;
    token: string;
    instanceId?: string;
  }) {
    this.instanceId = instanceId ?? `lci_${nanoid(6)}`;
    this.socket = new WebSocket(`${url}${CONTROL_CONNECT_PATH}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Project-Id": projectId,
      },
    });
    this.socket.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      this.frames.push(frame);
      for (const waiter of this.waiters.splice(0)) waiter(frame);
    });
  }

  readonly instanceId: string;

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
  }

  send(frame: Record<string, unknown>): void {
    this.socket.send(
      JSON.stringify({ protocol: LOCAL_CONTROL_PROTOCOL_VERSION, ...frame }),
    );
  }

  register(): void {
    this.send({
      type: "register",
      cli: { name: "langwatch", version: "1.0.0" },
      instance: {
        id: this.instanceId,
        hostname: "rogerio-mbp",
        username: "dev",
        pid: 4242,
        startedAt: new Date().toISOString(),
        inFlightCallIds: [],
      },
      workspace: workspaceInfo(),
    });
  }

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

  close(): void {
    this.socket.close();
  }

  closed(): Promise<{ code: number }> {
    return new Promise((resolve) =>
      this.socket.once("close", (code) => resolve({ code })),
    );
  }
}

/** A fresh control request, approved, with the session key it minted. */
async function approvedSessionKey(pod: Pod): Promise<string> {
  const request = await pod.runtime.requests.create({
    projectId,
    projectName: "Local Control Project",
    userId,
    conversationId,
    conversationTitle: "Instrument tracing",
    conversationUrl: `/?langyConversation=${conversationId}`,
  });
  const approved = await pod.runtime.requests.approve({
    requestId: request.id,
    userId,
    projectId,
  });
  return approved.sessionKey;
}

async function shareFolder(
  pod: Pod,
  token: string,
): Promise<{ cli: FakeCli; registered: Frame }> {
  const cli = new FakeCli({ url: pod.url, token });
  await cli.open();
  cli.register();
  const registered = await cli.next("registered");
  return { cli, registered };
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
    data: { name: "Local Control Org", slug: `--test-org-${ns}` },
  });
  team = await prisma.team.create({
    data: {
      name: "Local Control Team",
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
      name: "Local Control Project",
      slug: `--test-project-${ns}`,
      language: "typescript",
      framework: "other",
      apiKey: projectApiKey,
      teamId: team.id,
    },
  });
  projectId = project.id;

  personalToken = (
    await ApiKeyService.create(prisma).create({
      name: `personal-${ns}`,
      userId,
      createdByUserId: userId,
      organizationId: organization.id,
      permissionMode: "all",
      bindings: [
        {
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organization.id,
        },
      ],
    })
  ).token;

  podA = await startPod();
  podB = await startPod();
});

beforeEach(() => {
  conversationId = `conv_${nanoid(10)}`;
  turnId = `turn_${nanoid(10)}`;
  conversationRow = {
    id: conversationId,
    title: "Instrument tracing",
    currentTurnId: null,
    lastModel: "anthropic/claude-fable-5-1",
  };
  startedTurns = [];
  turnStartOutcome = "ok";
  events = [];
  liveEntries = [];
  skipAllowed = false;
});

afterAll(async () => {
  await stopPod(podA);
  await stopPod(podB);
  await cleanupTestRows(prisma, [
    ["roleBinding", { organizationId: organization.id }],
    ["customRole", { organizationId: organization.id }],
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

describe("given an approved control request", () => {
  describe("when the command line connects", () => {
    /** @scenario "A connected folder shows on the card and in the panel header" */
    it("records the folder path, the machine and the branch", async () => {
      const key = await approvedSessionKey(podA);
      const { cli, registered } = await shareFolder(podA, key);

      const connected = await podA.runtime.presence.read(conversationId);
      expect(connected?.workspace.root).toBe("/Users/dev/acme-app");
      expect(connected?.hostname).toBe("rogerio-mbp");
      expect(connected?.workspace.gitBranch).toBe("main");
      expect(registered.conversation).toMatchObject({ id: conversationId });

      cli.close();
      await cli.closed();
    });

    it("keeps refreshing presence while the socket stays open", async () => {
      const key = await approvedSessionKey(podA);
      const { cli } = await shareFolder(podA, key);
      // Let the writes registration itself makes settle, so the baseline is
      // the record as it stands with nothing but the heartbeat left to move it.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const before = (await podA.runtime.presence.read(conversationId))
        ?.lastSeenAt;
      expect(before).toBeDefined();

      // Five ping periods of an idle but healthy socket. The presence record
      // has to move: it expires thirty seconds after the last refresh, so a
      // heartbeat that never runs takes the folder offline mid-turn while the
      // command line is still connected.
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const after = (await podA.runtime.presence.read(conversationId))
        ?.lastSeenAt;
      expect(after).toBeGreaterThan(before!);

      cli.close();
      await cli.closed();
    });

    /** @scenario "The connection carries what Langy would otherwise probe" */
    it("carries the checklist Langy would spend a turn asking for", async () => {
      const key = await approvedSessionKey(podA);
      const { cli } = await shareFolder(podA, key);
      await expect
        .poll(
          () =>
            events.some((event) => event.name === "local_workspace_connected"),
          { timeout: 5_000 },
        )
        .toBe(true);

      const connectedEvent = events.find(
        (event) => event.name === "local_workspace_connected",
      );
      expect(connectedEvent?.data.workspace).toMatchObject({
        root: "/Users/dev/acme-app",
        gitBranch: "main",
        gitRemote: "git@github.com:acme/acme-app.git",
        gitDirty: false,
        os: "darwin",
        nodeVersion: "24.11.1",
        pythonVersion: "3.12.4",
        ghAuthenticated: true,
        packageManager: "pnpm",
      });

      cli.close();
      await cli.closed();
    });

    /** @scenario "Connecting starts the next turn on its own" */
    it("starts one turn that names the folder and the branch", async () => {
      const key = await approvedSessionKey(podA);
      const { cli } = await shareFolder(podA, key);
      await expect.poll(() => startedTurns.length, { timeout: 5_000 }).toBe(1);

      expect(startedTurns[0]?.text).toBe(
        "Local folder connected: /Users/dev/acme-app on rogerio-mbp, branch main",
      );
      expect(startedTurns[0]?.idempotencyKey).toMatch(/^local-connect:lcr_/);

      cli.close();
      await cli.closed();
    });

    /** @scenario "Connecting while a turn runs does not start a second turn" */
    it("records the connection and leaves the running turn alone", async () => {
      turnStartOutcome = "in_progress";
      const key = await approvedSessionKey(podA);
      const { cli } = await shareFolder(podA, key);
      await expect
        .poll(
          () =>
            events.some((event) => event.name === "local_workspace_connected"),
          { timeout: 5_000 },
        )
        .toBe(true);

      expect(startedTurns).toEqual([]);
      expect(await podA.runtime.presence.read(conversationId)).not.toBeNull();

      cli.close();
      await cli.closed();
    });
  });

  describe("when the credential is not the minted session key", () => {
    /** @scenario "The CLI connects with the session key alone" */
    it("refuses the connection and names the reason", async () => {
      const own = new FakeCli({ url: podA.url, token: personalToken });
      await own.open();
      own.register();
      const refusedOwn = await own.next("refused");

      expect(refusedOwn.code).toBe("key_type_not_allowed");
      expect(String(refusedOwn.message)).toContain("langwatch langy");
      await own.closed();

      // A project key is not even a bearer credential here, so it is refused
      // as invalid rather than as the wrong kind.
      const project = new FakeCli({ url: podA.url, token: projectApiKey });
      await project.open();
      project.register();
      expect((await project.next("refused")).code).toBe("api_key_invalid");
      await project.closed();
    });
  });
});

describe("given a folder shared with the conversation", () => {
  let key: string;
  let cli: FakeCli;

  beforeEach(async () => {
    key = await approvedSessionKey(podA);
    cli = (await shareFolder(podA, key)).cli;
  });

  afterEach(async () => {
    cli.close();
    await cli.closed();
  });

  describe("when Langy places a call from the replica that holds the socket", () => {
    /** @scenario "A local call travels to the CLI and its result comes back" */
    it("delivers the call and returns the result to the caller", async () => {
      const call = await podA.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_ls", params: { path: "." } },
        timeoutMs: 30_000,
      });
      const frame = await cli.next("call");

      expect(frame.call).toMatchObject({
        callId: call.callId,
        tool: "local_ls",
      });
      cli.send({ type: "ack", callId: call.callId });
      cli.send({
        type: "result",
        callId: call.callId,
        ok: true,
        text: "package.json\nsrc",
      });

      const answer = await podA.runtime.dispatcher.poll({
        callId: call.callId,
        holdMs: 5_000,
      });
      expect(answer).toMatchObject({
        state: "done",
        ok: true,
        text: "package.json\nsrc",
      });
    });
  });

  describe("when the call lands on the replica that does not hold the socket", () => {
    /** @scenario "A call and its socket can be on different pods" */
    it("still delivers it, and the result still reaches the caller", async () => {
      const call = await podB.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_read", params: { path: "src/index.ts" } },
        timeoutMs: 30_000,
      });
      const frame = await cli.next("call");
      expect(frame.call).toMatchObject({ callId: call.callId });

      cli.send({
        type: "result",
        callId: call.callId,
        ok: true,
        text: "export const app = 1;",
      });
      const answer = await podB.runtime.dispatcher.poll({
        callId: call.callId,
        holdMs: 5_000,
      });
      expect(answer).toMatchObject({ state: "done", ok: true });
    });
  });

  describe("when a command runs in the background", () => {
    /** @scenario "A background command returns at once with its process and log" */
    it("answers with the process id and the log path", async () => {
      const call = await podA.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: {
          tool: "local_bash",
          params: { command: "pnpm dev", background: true },
        },
        timeoutMs: 30_000,
      });
      await cli.next("call");
      cli.send({
        type: "result",
        callId: call.callId,
        ok: true,
        text: "started in the background",
        output: {
          exitCode: null,
          stdout: "",
          stderr: "",
          truncated: false,
          pid: 51234,
          logPath: ".langwatch/langy-logs/pnpm-dev.log",
          durationMs: 12,
        },
      });

      const answer = await podA.runtime.dispatcher.poll({
        callId: call.callId,
        holdMs: 5_000,
      });
      expect(answer?.output).toMatchObject({
        pid: 51234,
        logPath: ".langwatch/langy-logs/pnpm-dev.log",
      });
    });
  });

  describe("when the command line asks for the developer's permission", () => {
    /** @scenario "The skip choice is offered on the permission card" */
    it("offers the skip switch when the model is allowed to skip", async () => {
      skipAllowed = true;
      const call = await podA.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm typecheck" } },
        timeoutMs: 30_000,
      });
      await cli.next("call");
      cli.send({
        type: "permission_required",
        callId: call.callId,
        summary: "pnpm typecheck",
        pattern: "pnpm *",
        reason: "not on the read-only list",
        skipOffered: true,
      });

      await expect
        .poll(() => liveEntries.filter((e) => e.kind === "local_permission"), {
          timeout: 5_000,
        })
        .toHaveLength(1);
      const card = liveEntries.find((e) => e.kind === "local_permission");
      expect(card?.payload).toMatchObject({
        summary: "pnpm typecheck",
        pattern: "pnpm *",
        skipOffered: true,
        workspaceName: "acme-app",
        hostname: "rogerio-mbp",
        status: "pending",
      });
      expect((await podA.runtime.dispatcher.read(call.callId))?.state).toBe(
        "awaiting_permission",
      );
    });

    /** @scenario "A model outside the allowed list cannot skip" */
    it("hides the skip switch when the model is not allowed to skip", async () => {
      skipAllowed = false;
      const call = await podA.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "rm -rf build" } },
        timeoutMs: 30_000,
      });
      await cli.next("call");
      cli.send({
        type: "permission_required",
        callId: call.callId,
        summary: "rm -rf build",
        pattern: "rm *",
        reason: "removes files",
        skipOffered: true,
      });

      await expect
        .poll(() => liveEntries.filter((e) => e.kind === "local_permission"), {
          timeout: 5_000,
        })
        .toHaveLength(1);
      expect(
        liveEntries.find((e) => e.kind === "local_permission")?.payload,
      ).toMatchObject({ skipOffered: false });
    });
  });

  describe("when the developer answers the permission card", () => {
    /** @scenario "Allowing once runs the command and returns its output" */
    it("sends the decision to the command line and the call runs", async () => {
      const call = await podA.runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm typecheck" } },
        timeoutMs: 30_000,
      });
      await cli.next("call");
      cli.send({
        type: "permission_required",
        callId: call.callId,
        summary: "pnpm typecheck",
        pattern: "pnpm *",
        reason: "not on the read-only list",
        skipOffered: true,
      });
      await expect
        .poll(
          () => podA.runtime.waits.listPending({ conversationId, turnId }),
          {
            timeout: 5_000,
          },
        )
        .toHaveLength(1);

      const [wait] = await podA.runtime.waits.listPending({
        conversationId,
        turnId,
      });
      // The answer is given on the OTHER replica, the way a browser's request
      // lands wherever the load balancer sends it.
      await podB.runtime.waits.answer({
        waitId: wait!.waitId,
        userId,
        decision: "allow_once",
      });

      const permission = await cli.next("permission");
      expect(permission).toMatchObject({
        callId: call.callId,
        decision: "allow_once",
      });
    });
  });
});

describe("given a folder whose socket dropped", () => {
  /** @scenario "The connection survives a network blip" */
  it("keeps the folder connected and delivers the call after the reconnect", async () => {
    const key = await approvedSessionKey(podA);
    const first = await shareFolder(podA, key);
    first.cli.socket.terminate();
    await first.cli.closed();

    // A network drop is not a decision: the folder is still shared.
    expect(await podA.runtime.presence.read(conversationId)).not.toBeNull();

    const call = await podB.runtime.dispatcher.start({
      projectId,
      conversationId,
      turnId,
      call: { tool: "local_ls", params: { path: "." } },
      timeoutMs: 30_000,
    });

    const second = await shareFolder(podA, key);
    const frame = await second.cli.next("call");
    expect(frame.call).toMatchObject({ callId: call.callId });

    second.cli.close();
    await second.cli.closed();
  });
});

describe("given a folder the developer stops sharing", () => {
  /** @scenario "Ctrl-C disconnects at once, not when a heartbeat expires" */
  it("clears the folder at once and fails the call in flight", async () => {
    const key = await approvedSessionKey(podA);
    const { cli } = await shareFolder(podA, key);
    const call = await podA.runtime.dispatcher.start({
      projectId,
      conversationId,
      turnId,
      call: { tool: "local_bash", params: { command: "pnpm test" } },
      timeoutMs: 60_000,
    });
    await cli.next("call");

    cli.send({ type: "deregister" });
    await cli.closed();

    await expect
      .poll(() => podA.runtime.presence.read(conversationId), {
        timeout: 5_000,
      })
      .toBeNull();
    const answer = await podA.runtime.dispatcher.poll({
      callId: call.callId,
      holdMs: 2_000,
    });
    expect(answer).toMatchObject({ state: "done", ok: false });
    expect(answer?.error?.code).toBe("cancelled");
    expect(
      events.some((event) => event.name === "local_workspace_disconnected"),
    ).toBe(true);
  });
});

describe("given a network that blocks WebSockets", () => {
  /** @scenario "A local call travels to the CLI and its result comes back" */
  it("carries the same register, call and result over the long-poll routes", async () => {
    const key = await approvedSessionKey(podA);
    const registered = await podA.longPoll.register({
      authorization: `Bearer ${key}`,
      projectId,
      frame: {
        protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
        type: "register",
        cli: { name: "langwatch", version: "1.0.0" },
        instance: {
          id: `lci_${nanoid(6)}`,
          hostname: "rogerio-mbp",
          username: "dev",
          pid: 4242,
          startedAt: new Date().toISOString(),
          inFlightCallIds: [],
        },
        workspace: workspaceInfo(),
      },
    });

    expect(registered.ok).toBe(true);
    expect(registered.reply?.type).toBe("registered");
    const token = registered.token!;

    const call = await podB.runtime.dispatcher.start({
      projectId,
      conversationId,
      turnId,
      call: { tool: "local_ls", params: { path: "." } },
      timeoutMs: 30_000,
    });
    const polled = await podA.longPoll.poll({ token });
    expect(polled.frames[0]).toMatchObject({
      type: "call",
      call: { callId: call.callId },
    });

    await podA.longPoll.frames({
      token,
      frames: [
        {
          protocol: LOCAL_CONTROL_PROTOCOL_VERSION,
          type: "result",
          callId: call.callId,
          ok: true,
          text: "package.json",
        },
      ],
    });
    const answer = await podB.runtime.dispatcher.poll({
      callId: call.callId,
      holdMs: 5_000,
    });
    expect(answer).toMatchObject({ state: "done", ok: true });

    await podA.longPoll.retire(token, "cli_exit");
    expect(await podA.longPoll.poll({ token })).toMatchObject({ ok: false });
  });
});
