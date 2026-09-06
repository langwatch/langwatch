/**
 * @vitest-environment node
 *
 * The panel's half of local control, through the real tRPC surface: answering a
 * permission card, answering a question card, the skip switch and its model
 * gate, closing the folder from the header chip, and the remembered code
 * access choice. The runtime — presence, dispatcher, wait service and control
 * requests — is the real one over a process-memory store; the conversation
 * read, the durable commands, the model gate and the remembered choice are the
 * injected boundaries.
 *
 * @see specs/langy/langy-local-permissions.feature
 * @see specs/langy/langy-code-access.feature
 */

import { initTRPC } from "@trpc/server";
import { nanoid } from "nanoid";
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectedAgentStateAdapter } from "@langwatch/agent-server/testing";
import type { SkipPermissionsDecision } from "../../../services/langy-skip-permissions.service.ts";
import {
  LangyLocalControlRuntimeAdapter,
  type LocalControlRuntime,
} from "../../../adapters/langy-local-control-runtime.adapter.ts";
import {
  conversationKeyBindingsKey,
  sessionKeyBindingKey,
} from "../../../rules/langy-local-control-keys.rules.ts";
import { LangyTrpcApi, type LangyTrpcContext } from "../langy.api.ts";

const ns = nanoid(8);
const projectId = `p-local-${ns}`;
const organizationId = `org-local-${ns}`;
const userId = `user-local-${ns}`;
const conversationId = `conv-local-${ns}`;
const otherConversationId = `conv-other-${ns}`;
const turnId = `turn-local-${ns}`;

/** Every durable command the router and the wait service dispatched. */
let commands: { name: string; data: Record<string, unknown> }[] = [];
/** The model the conversation last ran on, as the projection would hold it. */
let lastModel: string | null;
/** Whether the conversation's model may skip the permission cards. */
let skipDecision: SkipPermissionsDecision;
/** The person's remembered code access choice, as the profile would hold it. */
let codeAccessPreference: string | null;

let runtime: LocalControlRuntime;
let caller: ReturnType<ReturnType<typeof buildRouter>["createCaller"]>;

function conversationRow(id: string) {
  return {
    id,
    title: "Instrument tracing",
    currentTurnId: null,
    lastModel,
    isOwn: true,
  };
}

function buildRouter() {
  const trpc = initTRPC.context<LangyTrpcContext>().create();
  return LangyTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure.use(({ ctx, next }) => next({ ctx })),
      policy: () => (procedure) => procedure,
      validateOutput: true,
    },
    {
      checkMessageRateLimit: async () => ({ allowed: true }),
      checkWarmRateLimit: async () => ({ allowed: true }),
      recordProductEvent: () => {},
      uiActions: {
        claim: async () => ({ isClaimed: true }),
        complete: async () => ({ isAccepted: true }),
      },
      local: {
        runtime,
        commands: {
          changeLocalPolicy: async (data) => {
            commands.push({ name: "local_policy_changed", data });
          },
          disconnectLocalWorkspace: async (data) => {
            commands.push({ name: "local_workspace_disconnected", data });
          },
        },
        skipGate: async () => skipDecision,
        codeAccess: {
          tryRead: async () => codeAccessPreference,
          write: async ({ preference }) => {
            codeAccessPreference = preference;
          },
        },
      },
    },
  );
}

/** The conversation read and the actor every local-control procedure sees. */
function context(): LangyTrpcContext {
  return {
    app: {
      langy: {
        tryFindVisible: async ({ id }: { id: string }) =>
          id === conversationId || id === otherConversationId ? conversationRow(id) : null,
      },
    },
    actor: () => ({ id: userId }),
    session: { user: { id: userId } },
  } as unknown as LangyTrpcContext;
}

/** The folder, as the command line's register frame leaves it in presence. */
async function shareFolder(): Promise<void> {
  const now = Date.now();
  await runtime.presence.register({
    conversationId,
    projectId,
    userId,
    requestId: `lcr_${ns}`,
    instanceId: `lci_${ns}`,
    hostname: "rogerio-mbp",
    connectedAt: now,
    lastSeenAt: now,
    workspace: {
      root: "/Users/dev/acme-app",
      name: "acme-app",
      gitBranch: "main",
      os: "darwin",
    },
  });
}

/** A local command waiting on the developer's answer. */
async function permissionCard(): Promise<{ waitId: string; callId: string }> {
  const call = await runtime.dispatcher.start({
    projectId,
    conversationId,
    turnId,
    call: { tool: "local_bash", params: { command: "pnpm typecheck" } },
    timeoutMs: 60_000,
  });
  const wait = await runtime.waits.startPermission({
    projectId,
    conversationId,
    turnId,
    callId: call.callId,
    summary: "pnpm typecheck",
    pattern: "pnpm *",
    patterns: ["pnpm *"],
    reason: "not on the read-only list",
    skipOffered: true,
    workspaceName: "acme-app",
    hostname: "rogerio-mbp",
  });
  await runtime.dispatcher.tryAwaitPermission({
    callId: call.callId,
    waitId: wait.waitId,
  });
  return { waitId: wait.waitId, callId: call.callId };
}

beforeEach(async () => {
  commands = [];
  lastModel = "anthropic/claude-fable-5-1";
  skipDecision = { allowed: false, provider: "openai", modelId: "gpt-5-mini" };
  codeAccessPreference = null;

  // A store per test: process memory is the whole truth for one file, and a
  // fresh one is cheaper than unwinding presence, calls and cards by hand.
  runtime = LangyLocalControlRuntimeAdapter.create({
    store: ConnectedAgentStateAdapter.memory(),
    projects: { tryReadOrganizationId: async () => organizationId },
    mintSessionKey: async () => ({
      token: `sk-lw-${nanoid(48)}`,
      apiKeyId: `key_${nanoid(10)}`,
    }),
    offlineWaitMs: 200,
    pollIntervalMs: 25,
    events: {
      async startUserWait(data) {
        commands.push({ name: "user_wait_started", data });
      },
      async endUserWait(data) {
        commands.push({ name: "user_wait_ended", data });
      },
    },
    buffer: {
      async appendLocalPermission() {},
      async appendQuestion() {},
      async appendStatus() {},
      async heartbeat() {},
    },
  });
  caller = buildRouter().createCaller(context());
});

describe("given a permission card waiting in the chat", () => {
  beforeEach(shareFolder);

  describe("when the developer allows the command once", () => {
    /** @scenario "The answered card is recorded, so a reload shows the same outcome" */
    it("records the answer and locks the card", async () => {
      const { waitId, callId } = await permissionCard();

      await caller.answerLocalPermission({
        projectId,
        conversationId,
        waitId,
        decision: "allow_once",
      });

      expect(await runtime.waits.tryRead(waitId)).toMatchObject({
        state: "answered",
        decision: "allow_once",
        answeredBy: userId,
      });
      expect(commands.find((command) => command.name === "user_wait_ended")?.data).toMatchObject({
        outcome: "answered",
        decision: "allow_once",
      });
      // The card released the command, so the call is running again.
      expect((await runtime.dispatcher.tryRead(callId))?.state).toBe("running");
    });
  });

  describe("when the developer answers a card that already settled", () => {
    /** @scenario "A late answer to an expired card does nothing" */
    it("refuses with the code that sends the answer as a message instead", async () => {
      const { waitId } = await permissionCard();
      await caller.answerLocalPermission({
        projectId,
        conversationId,
        waitId,
        decision: "deny",
      });

      await expect(
        caller.answerLocalPermission({
          projectId,
          conversationId,
          waitId,
          decision: "allow_once",
        }),
      ).rejects.toMatchObject({ cause: { code: "langy_wait_expired" } });
    });
  });

  describe("when the card belongs to another conversation", () => {
    it("refuses the answer rather than reaching that folder", async () => {
      const { waitId } = await permissionCard();

      await expect(
        caller.answerLocalPermission({
          projectId,
          conversationId: otherConversationId,
          waitId,
          decision: "allow_once",
        }),
      ).rejects.toMatchObject({ cause: { code: "langy_wait_expired" } });
    });
  });
});

describe("given a question Langy asked mid-task", () => {
  beforeEach(shareFolder);

  describe("when the developer picks an option", () => {
    /** @scenario "Selecting an option returns it to the tool and the turn continues" */
    it("records the selection on the card the tool is waiting on", async () => {
      const wait = await runtime.waits.startQuestion({
        projectId,
        conversationId,
        turnId,
        questions: [
          {
            question: "Which account should the fixture use?",
            options: [{ label: "acme-free" }, { label: "acme-pro" }],
          },
        ],
      });

      await caller.answerQuestion({
        projectId,
        conversationId,
        waitId: wait.waitId,
        answers: [
          {
            question: "Which account should the fixture use?",
            selected: ["acme-free"],
          },
        ],
      });

      expect(await runtime.waits.tryPoll({ waitId: wait.waitId, holdMs: 0 })).toMatchObject({
        state: "answered",
        answers: [{ selected: ["acme-free"] }],
      });
    });
  });
});

describe("given a folder shared with the conversation", () => {
  beforeEach(shareFolder);

  describe("when the model is allowed to skip the permission checks", () => {
    /** @scenario "Skipping records my consent and stops the cards" */
    it("records the consent and reports the cards off", async () => {
      skipDecision = { allowed: true, provider: "anthropic", modelId: "claude-fable-5-1" };

      const answer = await caller.setLocalPolicy({
        projectId,
        conversationId,
        skipPermissions: true,
      });

      expect(answer).toEqual({ skipPermissions: true });
      expect(
        commands.find((command) => command.name === "local_policy_changed")?.data,
      ).toMatchObject({
        userId,
        skipPermissions: true,
        model: "anthropic/claude-fable-5-1",
      });
      expect(await caller.getLocalWorkspace({ projectId, conversationId })).toMatchObject({
        connected: true,
        skipAllowed: true,
        skipPermissions: true,
      });
    });
  });

  describe("when the model is not allowed to skip", () => {
    /** @scenario "A model outside the allowed list cannot skip" */
    it("refuses the choice and names the provider settings", async () => {
      await expect(
        caller.setLocalPolicy({ projectId, conversationId, skipPermissions: true }),
      ).rejects.toMatchObject({
        cause: { code: "langy_local_skip_model_not_allowed" },
      });
      expect(await runtime.presence.readPolicy(conversationId)).toBe(false);
    });
  });

  describe("when the conversation moves to a model that may not skip", () => {
    /** @scenario "Changing the model ends the skip" */
    it("takes the skip back, so the next command asks again", async () => {
      skipDecision = { allowed: true, provider: "anthropic", modelId: "claude-fable-5-1" };
      await caller.setLocalPolicy({ projectId, conversationId, skipPermissions: true });

      skipDecision = { allowed: false, provider: "openai", modelId: "gpt-5-mini" };
      lastModel = "openai/gpt-5-mini";

      expect(await caller.getLocalWorkspace({ projectId, conversationId })).toMatchObject({
        skipAllowed: false,
        skipPermissions: false,
      });
      expect(commands.filter((command) => command.name === "local_policy_changed")).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({ skipPermissions: false }),
        }),
      );
    });
  });

  describe("when the developer closes the folder from the header chip", () => {
    /** @scenario "Disconnecting from the panel revokes the key" */
    it("clears the folder, records it, and fails the call in flight", async () => {
      const call = await runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm test" } },
        timeoutMs: 60_000,
      });

      const answer = await caller.disconnectLocalWorkspace({ projectId, conversationId });

      expect(answer).toEqual({ disconnected: true });
      expect(await runtime.presence.read(conversationId)).toBeNull();
      expect((await runtime.dispatcher.tryRead(call.callId))?.state).toBe("done");
      expect(
        commands.find((command) => command.name === "local_workspace_disconnected")?.data,
      ).toMatchObject({ reason: "panel" });
    });
  });

  describe("when the command line never receives the disconnect", () => {
    /** @scenario "Disconnecting revokes the key even when the command line cannot be reached" */
    it("revokes the key that controlled the conversation, whatever presence says", async () => {
      // The frame the mutation publishes is best effort. A command line that
      // lost the network a second earlier misses it, and its own reconnect
      // used to pass on a binding that lives six hours.
      const apiKeyId = `key-${ns}`;
      await runtime.store.set(
        sessionKeyBindingKey(apiKeyId),
        JSON.stringify({ conversationId, projectId, userId, requestId: `lcr_${ns}` }),
        3600,
      );
      await runtime.store.zadd({
        key: conversationKeyBindingsKey(conversationId),
        score: Date.now() + 3_600_000,
        member: apiKeyId,
        ttlSeconds: 3600,
      });
      // The folder record has already lapsed: the machine went to sleep.
      await runtime.presence.deregister({ conversationId });

      const answer = await caller.disconnectLocalWorkspace({ projectId, conversationId });

      expect(answer).toEqual({ disconnected: false });
      expect(await runtime.requests.tryReadKeyBinding(apiKeyId)).toBeNull();
    });
  });

  describe("when the folder is gone and Langy needs the code again", () => {
    /** @scenario "A disconnected folder is asked for again" */
    it("reads no folder, and the fresh request is what the card waits on", async () => {
      await caller.disconnectLocalWorkspace({ projectId, conversationId });
      const request = await runtime.requests.create({
        projectId,
        projectName: "Local Control Project",
        userId,
        conversationId,
        conversationTitle: "Instrument tracing",
        conversationUrl: `/?langyConversation=${conversationId}`,
      });

      expect(await caller.getLocalWorkspace({ projectId, conversationId })).toMatchObject({
        connected: false,
        pendingRequest: expect.objectContaining({ id: request.id }),
      });
    });
  });

  describe("when another conversation asks about the folder", () => {
    /** @scenario "A folder connected in another conversation does not count" */
    it("reads no folder there, because a share belongs to one chat", async () => {
      expect(
        await caller.getLocalWorkspace({ projectId, conversationId: otherConversationId }),
      ).toMatchObject({ connected: false, workspace: null });
    });
  });
});

describe("given the developer chose GitHub and asked to be remembered", () => {
  describe("when the choice is stored", () => {
    /** @scenario "The remembered choice can be cleared from the integrations settings" */
    it("reads back as the remembered choice, and clears again", async () => {
      await caller.setCodeAccessPreference({ projectId, preference: "github" });
      expect(await caller.getLocalWorkspace({ projectId, conversationId })).toMatchObject({
        codeAccessPreference: "github",
      });

      await caller.setCodeAccessPreference({ projectId, preference: null });
      expect(await caller.getLocalWorkspace({ projectId, conversationId })).toMatchObject({
        codeAccessPreference: null,
      });
    });
  });

  describe("when the choice offered is the local folder", () => {
    /** @scenario "The local folder is never remembered" */
    it("is refused, because a folder has to be shared again each time", async () => {
      await expect(
        caller.setCodeAccessPreference({ projectId, preference: "local" as never }),
      ).rejects.toThrow();
      expect(codeAccessPreference).toBeNull();
    });
  });
});
