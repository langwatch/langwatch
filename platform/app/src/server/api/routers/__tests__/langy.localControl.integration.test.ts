/**
 * @vitest-environment node
 *
 * The panel's half of local control, through the real tRPC router: answering a
 * permission card, answering a question card, the skip switch and its model
 * gate, closing the folder from the header chip, and the remembered code
 * access choice. The wait service, the dispatcher and the presence record are
 * the real ones; the conversation read, the durable commands, the model gate
 * and the two transport middlewares are the boundaries.
 *
 * @see specs/langy/langy-local-permissions.feature
 * @see specs/langy/langy-code-access.feature
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { appHolder, skipDecision } = vi.hoisted(() => ({
  appHolder: { current: null as unknown },
  skipDecision: {
    current: { allowed: false, provider: "openai", modelId: "gpt-5-mini" },
  },
}));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => appHolder.current,
  getApp: () => appHolder.current,
}));

// The rollout gate and the demo refusal are transport concerns with their own
// unit tests; this file is about what the panel may do to a shared folder.
vi.mock("../langyAccessMiddleware", () => ({
  enforceLangyAccess: ({ next }: { next: () => unknown }) => next(),
  refuseDemoProject: ({ next }: { next: () => unknown }) => next(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

vi.mock("~/server/app-layer/langy/langySkipPermissions", () => ({
  canModelSkipPermissions: async () => skipDecision.current,
}));

import { prisma } from "~/server/db";
import {
  closeLocalControlRuntime,
  getLocalControlRuntime,
} from "~/server/langy-local-control/runtime";
import { createInnerTRPCContext } from "../../trpc";
import { langyRouter } from "../langy";

const ns = nanoid(8);
const projectId = `p-local-${ns}`;
const conversationId = `conv-local-${ns}`;
const otherConversationId = `conv-other-${ns}`;
const turnId = `turn-local-${ns}`;

let userId: string;

/** Every durable command the router and the wait service dispatched. */
let commands: { name: string; data: Record<string, unknown> }[] = [];
/** The model the conversation last ran on, as the projection would hold it. */
let lastModel: string | null;

function conversationRow(id: string) {
  return {
    id,
    title: "Instrument tracing",
    currentTurnId: null,
    lastModel,
    isOwn: true,
  };
}

function caller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: userId }, expires: "1" } as never,
    permissionChecked: true,
  });
  return langyRouter.createCaller(ctx);
}

/** The folder, as the command line's register frame leaves it in presence. */
async function shareFolder(): Promise<void> {
  const now = Date.now();
  await getLocalControlRuntime().presence.register({
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
  const runtime = getLocalControlRuntime();
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
    reason: "not on the read-only list",
    skipOffered: true,
    workspaceName: "acme-app",
    hostname: "rogerio-mbp",
  });
  await runtime.dispatcher.awaitPermission({
    callId: call.callId,
    waitId: wait.waitId,
  });
  return { waitId: wait.waitId, callId: call.callId };
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { name: "Rogerio", email: `local-control-${ns}@example.com` },
  });
  userId = user.id;
  appHolder.current = {
    // No Redis: the runtime falls back to process memory, which is the whole
    // truth for one test file and needs no cleanup between tests.
    redis: null,
    // The permission gate of every Langy procedure decides here (ADR-092).
    permissions: {
      getDecision: async () => ({
        permitted: true,
        organizationRole: "ADMIN",
      }),
    },
    langy: {
      conversations: {
        findByIdVisible: async ({ id }: { id: string }) =>
          id === conversationId || id === otherConversationId
            ? conversationRow(id)
            : null,
      },
    },
    commands: {
      langy: {
        changeLocalPolicy: async (data: Record<string, unknown>) => {
          commands.push({ name: "local_policy_changed", data });
        },
        disconnectLocalWorkspace: async (data: Record<string, unknown>) => {
          commands.push({ name: "local_workspace_disconnected", data });
        },
        startUserWait: async (data: Record<string, unknown>) => {
          commands.push({ name: "user_wait_started", data });
        },
        endUserWait: async (data: Record<string, unknown>) => {
          commands.push({ name: "user_wait_ended", data });
        },
      },
    },
  };
});

beforeEach(async () => {
  commands = [];
  lastModel = "anthropic/claude-fable-5-1";
  skipDecision.current = {
    allowed: false,
    provider: "openai",
    modelId: "gpt-5-mini",
  };
  const runtime = getLocalControlRuntime();
  await runtime.presence.writePolicy({
    conversationId,
    skipPermissions: false,
  });
  await runtime.presence.deregister({ conversationId });
  await prisma.user.update({
    where: { id: userId },
    data: { langyCodeAccessPreference: null },
  });
});

afterAll(async () => {
  await closeLocalControlRuntime();
  await prisma.user.delete({ where: { id: userId } });
});

describe("given a permission card waiting in the chat", () => {
  beforeEach(shareFolder);

  describe("when the developer allows the command once", () => {
    /** @scenario "The answered card is recorded, so a reload shows the same outcome" */
    it("records the answer and locks the card", async () => {
      const { waitId, callId } = await permissionCard();

      await caller().answerLocalPermission({
        projectId,
        conversationId,
        waitId,
        decision: "allow_once",
      });

      const runtime = getLocalControlRuntime();
      expect(await runtime.waits.read(waitId)).toMatchObject({
        state: "answered",
        decision: "allow_once",
        answeredBy: userId,
      });
      expect(
        commands.find((command) => command.name === "user_wait_ended")?.data,
      ).toMatchObject({ outcome: "answered", decision: "allow_once" });
      // The card released the command, so the call is running again.
      expect((await runtime.dispatcher.read(callId))?.state).toBe("running");
    });
  });

  describe("when the developer answers a card that already settled", () => {
    /** @scenario "A late answer to an expired card does nothing" */
    it("refuses with the code that sends the answer as a message instead", async () => {
      const { waitId } = await permissionCard();
      await caller().answerLocalPermission({
        projectId,
        conversationId,
        waitId,
        decision: "deny",
      });

      await expect(
        caller().answerLocalPermission({
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
        caller().answerLocalPermission({
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
      const wait = await getLocalControlRuntime().waits.startQuestion({
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

      await caller().answerQuestion({
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

      const answered = await getLocalControlRuntime().waits.poll({
        waitId: wait.waitId,
        holdMs: 0,
      });
      expect(answered).toMatchObject({
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
      skipDecision.current = {
        allowed: true,
        provider: "anthropic",
        modelId: "claude-fable-5-1",
      };

      const answer = await caller().setLocalPolicy({
        projectId,
        conversationId,
        skipPermissions: true,
      });

      expect(answer).toEqual({ skipPermissions: true });
      expect(
        commands.find((command) => command.name === "local_policy_changed")
          ?.data,
      ).toMatchObject({
        userId,
        skipPermissions: true,
        model: "anthropic/claude-fable-5-1",
      });
      const workspace = await caller().getLocalWorkspace({
        projectId,
        conversationId,
      });
      expect(workspace).toMatchObject({
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
        caller().setLocalPolicy({
          projectId,
          conversationId,
          skipPermissions: true,
        }),
      ).rejects.toMatchObject({
        cause: { code: "langy_local_skip_model_not_allowed" },
      });
      expect(
        await getLocalControlRuntime().presence.readPolicy(conversationId),
      ).toBe(false);
    });
  });

  describe("when the conversation moves to a model that may not skip", () => {
    /** @scenario "Changing the model ends the skip" */
    it("takes the skip back, so the next command asks again", async () => {
      skipDecision.current = {
        allowed: true,
        provider: "anthropic",
        modelId: "claude-fable-5-1",
      };
      await caller().setLocalPolicy({
        projectId,
        conversationId,
        skipPermissions: true,
      });

      skipDecision.current = {
        allowed: false,
        provider: "openai",
        modelId: "gpt-5-mini",
      };
      lastModel = "openai/gpt-5-mini";

      const workspace = await caller().getLocalWorkspace({
        projectId,
        conversationId,
      });
      expect(workspace).toMatchObject({
        skipAllowed: false,
        skipPermissions: false,
      });
      expect(
        commands.filter((command) => command.name === "local_policy_changed"),
      ).toContainEqual(
        expect.objectContaining({
          data: expect.objectContaining({ skipPermissions: false }),
        }),
      );
    });
  });

  describe("when the developer closes the folder from the header chip", () => {
    /** @scenario "Disconnecting from the panel revokes the key" */
    it("clears the folder, records it, and fails the call in flight", async () => {
      const runtime = getLocalControlRuntime();
      const call = await runtime.dispatcher.start({
        projectId,
        conversationId,
        turnId,
        call: { tool: "local_bash", params: { command: "pnpm test" } },
        timeoutMs: 60_000,
      });

      const answer = await caller().disconnectLocalWorkspace({
        projectId,
        conversationId,
      });

      expect(answer).toEqual({ disconnected: true });
      expect(await runtime.presence.read(conversationId)).toBeNull();
      expect((await runtime.dispatcher.read(call.callId))?.state).toBe("done");
      expect(
        commands.find(
          (command) => command.name === "local_workspace_disconnected",
        )?.data,
      ).toMatchObject({ reason: "panel" });
    });
  });

  describe("when the folder is gone and Langy needs the code again", () => {
    /** @scenario "A disconnected folder is asked for again" */
    it("reads no folder, and the fresh request is what the card waits on", async () => {
      await caller().disconnectLocalWorkspace({ projectId, conversationId });
      const request = await getLocalControlRuntime().requests.create({
        projectId,
        projectName: "Local Control Project",
        userId,
        conversationId,
        conversationTitle: "Instrument tracing",
        conversationUrl: `/?langyConversation=${conversationId}`,
      });

      expect(
        await caller().getLocalWorkspace({ projectId, conversationId }),
      ).toMatchObject({
        connected: false,
        pendingRequest: expect.objectContaining({ id: request.id }),
      });
    });
  });

  describe("when another conversation asks about the folder", () => {
    /** @scenario "A folder connected in another conversation does not count" */
    it("reads no folder there, because a share belongs to one chat", async () => {
      expect(
        await caller().getLocalWorkspace({
          projectId,
          conversationId: otherConversationId,
        }),
      ).toMatchObject({ connected: false, workspace: null });
    });
  });
});

describe("given the developer chose GitHub and asked to be remembered", () => {
  describe("when the choice is stored", () => {
    /** @scenario "The remembered choice can be cleared from the integrations settings" */
    it("reads back as the remembered choice, and clears again", async () => {
      await caller().setCodeAccessPreference({
        projectId,
        preference: "github",
      });
      expect(
        await caller().getLocalWorkspace({ projectId, conversationId }),
      ).toMatchObject({ codeAccessPreference: "github" });

      await caller().setCodeAccessPreference({ projectId, preference: null });
      expect(
        await caller().getLocalWorkspace({ projectId, conversationId }),
      ).toMatchObject({ codeAccessPreference: null });
    });
  });

  describe("when the choice offered is the local folder", () => {
    /** @scenario "The local folder is never remembered" */
    it("is refused, because a folder has to be shared again each time", async () => {
      await expect(
        caller().setCodeAccessPreference({
          projectId,
          preference: "local" as never,
        }),
      ).rejects.toThrow();
      expect(
        (
          await prisma.user.findUnique({
            where: { id: userId },
            select: { langyCodeAccessPreference: true },
          })
        )?.langyCodeAccessPreference,
      ).toBeNull();
    });
  });
});
