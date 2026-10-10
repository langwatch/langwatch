/**
 * What an unattended turn is handed: an allowlisted key of its own, no GitHub token, no UI
 * action, no mirror copy, and a run conversation under its title. Every later turn in that
 * conversation keeps the same; a chat turn anywhere else keeps what it had.
 * @vitest-environment node
 * @see modules/langy/specs/langy-unattended-turn.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi, AuthzEffectivePermissionsOutput } from "@langwatch/authz-contract";
import { LANGY_CONVERSATION_STATUS, LangyTurnsRateLimitedError } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  conversationDetail,
  langyTurnDeps,
  workerCredentials,
} from "../../../../__tests__/support/langy-turn-deps.ts";
import type { LangyWorker } from "../../../../channels/langy-worker.channel.ts";
import type { LangyCredentialRepository } from "../../../../repositories/langy-credential.repository.ts";
import { LangySessionKeyRepository } from "../../../../repositories/langy-session-key.repository.ts";
import type { ConversationDetail } from "../../../../rules/langy-conversation-shape.rules.ts";
import { LangyCredentialService } from "../../../../services/langy-credential.service.ts";
import type { LangyConversationService } from "../../../conversation/services/langy-conversation.service.ts";
import {
  LANGY_CANDIDATE_PERMISSIONS,
  LANGY_UNATTENDED_PERMISSIONS,
  LangySessionKeyService,
} from "../../../session-key/services/langy-session-key.service.ts";
import type { LangyTurnServiceDependencies } from "../langy-turn-shared.service.ts";
import { LangyTurnService, type StartConversationTurnInput } from "../langy-turn.service.ts";

const RUN_TITLE = "Daily insights - Costs - 2026-10-09";

const chatTurn: StartConversationTurnInput = {
  projectId: "project-1",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  session: { user: { id: "user-1" } },
  requestedConversationId: null,
  messages: [{ role: "user", parts: [{ type: "text", text: "Read the board." }] }],
  isRetry: false,
  turnContext: {},
};
/** An unattended turn, with the count of its window to watch. */
function unattended() {
  const countTurn = vi.fn(async () => undefined);
  const turn: StartConversationTurnInput = {
    ...chatTurn,
    unattended: { title: RUN_TITLE, countTurn },
  };
  return { turn, countTurn };
}
const unattendedTurn = unattended().turn;
/** A message the person sends in a conversation that exists, such as a reply under a run. */
const replyIn = (conversationId: string): StartConversationTurnInput => ({
  ...chatTurn,
  requestedConversationId: conversationId,
});

class SessionKeyScope extends LangySessionKeyRepository {
  async getProjectScope() {
    return { teamId: "team-1", organizationId: "organization-1" };
  }
  async getById(): Promise<never> {
    throw new Error("no key is read while one is minted");
  }
  async revoke(): Promise<void> {}
}

/** The real key service over the permissions the person holds; `created` is what it asked for. */
function sessionKeysHolding(held: AuthzEffectivePermissionsOutput) {
  const created: string[][] = [];
  const apiKeys: ApiKeyApi = Object.create(null);
  apiKeys.create = async (input) => {
    created.push([...(input.permissions ?? [])]);
    return { token: "session-key", apiKey: Object.assign(Object.create(null), { id: "key-1" }) };
  };
  const authz = createApiFixture<AuthzApi>({ effectivePermissions: async () => held });
  const service = LangySessionKeyService.create({
    repository: new SessionKeyScope(),
    apiKeys,
    authz,
    metrics: { record: () => undefined },
  });
  return { service, created };
}

/** The real credential service over a project with GitHub connected. */
function credentialsWithGithub() {
  const findTurnTokens = vi.fn(async () => [{ token: "gh-token", repoScopeKey: "acme/shop" }]);
  const service = LangyCredentialService.create({
    repository: createApiFixture<LangyCredentialRepository>({
      getProject: async () => ({ organizationId: "organization-1" }),
    }),
    sessionKeys: { mint: vi.fn(), revokeManaged: vi.fn() },
    virtualKeys: { provision: async () => "vk" },
    github: { enabled: true, findTurnTokens },
    runtime: {
      workerCallbackUrl: "http://langwatch.test",
      workerGatewayBaseUrl: "http://gateway.test",
      mirrorProjectId: undefined,
    },
  });
  const credentials: Partial<LangyTurnServiceDependencies["credentials"]> = {
    getOrProvision: (input) => service.getOrProvision(input),
    findEgressAllowlist: async () => null,
    resolveMirrorTier: async () => "content" as const,
    findModelsAllowed: async () => null,
  };
  return { credentials, findTurnTokens };
}

function makeFixture({
  sessionKeys,
  credentials,
  workerRunning = false,
  existing,
  admission = "claimed",
}: {
  sessionKeys?: LangyTurnServiceDependencies["sessionKeys"];
  credentials?: Partial<LangyTurnServiceDependencies["credentials"]>;
  workerRunning?: boolean;
  /** The conversation the turn continues, as its row reads; `null` is a row that is gone. */
  existing?: Partial<ConversationDetail> | null;
  /** How the turn's admission answers: a first claim, or a replay of a turn already taken. */
  admission?: "claimed" | "replay";
} = {}) {
  const dispatch = vi.fn<LangyWorker["dispatch"]>(async () => "accepted");
  const acceptTurn = vi.fn(
    async (_input: Parameters<LangyConversationService["acceptTurn"]>[0]) => ({ turnId: "turn-1" }),
  );
  const mint = vi.fn<LangyTurnServiceDependencies["sessionKeys"]["mint"]>(
    sessionKeys
      ? (input) => sessionKeys.mint(input)
      : async () => ({ token: "session-key", apiKeyId: "key-1" }),
  );
  const stash = vi.fn<LangyTurnServiceDependencies["handoffStore"]["stash"]>(async () => undefined);
  const abort = vi.fn(async () => undefined);
  const render = vi.fn<LangyTurnServiceDependencies["context"]["render"]>(() => null);
  const warm = vi.fn<LangyWorker["warm"]>(async () => undefined);

  const deps = langyTurnDeps({
    conversations: {
      ensureConversation: vi.fn(async () => ({
        id: "conversation-1",
        isNew: existing === undefined,
      })),
      findByIdVisible: vi.fn(async () =>
        existing === null
          ? null
          : conversationDetail({ status: LANGY_CONVERSATION_STATUS.IDLE, ...existing }),
      ),
      findPendingHandoff: vi.fn(async () => null),
      findRunToken: vi.fn(async () => "run-token"),
      acceptTurn,
      finalizeTurn: vi.fn(async () => ({ messageId: "message-1" })),
    },
    credentials: credentials ?? {
      getOrProvision: vi.fn(async () => workerCredentials({ organizationId: "organization-1" })),
      findEgressAllowlist: vi.fn(async () => null),
      resolveMirrorTier: vi.fn(async () => "content" as const),
      findModelsAllowed: vi.fn(async () => null),
    },
    models: { resolve: vi.fn(async () => ({ modelId: "openai/gpt-5-mini" })) },
    worker: {
      probe: vi.fn(async () => workerRunning),
      dispatch,
      cancel: vi.fn(async () => undefined),
      warm,
    },
    permits: {
      reserve: vi.fn(async () => ({ reserved: true, allowed: true, resetAt: 0 })),
      release: vi.fn(async () => undefined),
      check: vi.fn(async () => ({ allowed: true })),
    },
    perDayPrCap: 5,
    sessionKeys: { mint, revoke: vi.fn(async () => undefined) },
    context: { render },
    uiActionSurface: { resolve: vi.fn(async () => true) },
    skillGates: { resolveDisabled: vi.fn(async () => []) },
    metrics: { count: vi.fn() },
    admission: {
      claim: vi.fn(async () =>
        admission === "replay"
          ? { kind: "replay" as const, conversationId: "conversation-1", turnId: "turn-1" }
          : {
              kind: "claimed" as const,
              claimToken: "claim-1",
              conversationId: "conversation-1",
              turnId: "turn-1",
            },
      ),
      commit: vi.fn(async () => undefined),
      abort,
      release: vi.fn(async () => undefined),
    },
    accessStore: {
      grant: vi.fn(async () => undefined),
      isTurnActor: vi.fn(async () => true),
    },
    handoffStore: { stash },
    messages: { findAllByConversation: vi.fn(async () => []) },
  });

  const turns = LangyTurnService.create(deps);
  const start = (input: StartConversationTurnInput) => turns.startConversationTurn(input);
  const warmUp = (conversationId: string) =>
    turns.warmConversationWorker({
      projectId: "project-1",
      session: { user: { id: "user-1" } },
      requestedConversationId: conversationId,
    });
  return { start, warmUp, dispatch, acceptTurn, mint, stash, abort, render, warm };
}

/** A conversation a module started for the person: its row reads the origin `run`. */
const RUN_CONVERSATION = { origin: "run" } as const;

describe("an unattended Langy turn", () => {
  describe("given a person who may view, update and delete in a project", () => {
    const held: AuthzEffectivePermissionsOutput = [
      "project:view",
      "team:view",
      "datasets:view",
      "analytics:view",
      "traces:view",
      "traces:update",
      "prompts:update",
      "datasets:delete",
    ];

    /** @scenario "An unattended turn's key holds view permissions only" */
    it("hands the worker a key holding the view permissions a board read needs and no other", async () => {
      const keys = sessionKeysHolding(held);
      const fixture = makeFixture({ sessionKeys: keys.service });

      await fixture.start(unattendedTurn);

      expect(keys.created).toEqual([["analytics:view", "traces:view"]]);
      expect(fixture.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({
            langwatchApiKey: "session-key",
            langwatchApiKeyId: "key-1",
          }),
        }),
      );
    });

    /** @scenario "A chat turn keeps the full ceiling and its GitHub token" */
    it("mints a chat turn's key with every permission Langy may hold for them", async () => {
      const keys = sessionKeysHolding([...LANGY_CANDIDATE_PERMISSIONS]);
      const github = credentialsWithGithub();
      const fixture = makeFixture({ sessionKeys: keys.service, credentials: github.credentials });

      await fixture.start(chatTurn);

      expect(keys.created).toEqual([[...LANGY_CANDIDATE_PERMISSIONS]]);
      expect(keys.created[0]).toContain("prompts:update");
      expect(fixture.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({ githubToken: "gh-token" }),
        }),
      );
    });
  });

  describe("given a project with GitHub connected", () => {
    /** @scenario "An unattended turn asks for no GitHub token" */
    it("asks for no GitHub token and hands the worker none", async () => {
      const github = credentialsWithGithub();
      const fixture = makeFixture({ credentials: github.credentials });

      await fixture.start(unattendedTurn);

      expect(github.findTurnTokens).not.toHaveBeenCalled();
      const dispatched = fixture.dispatch.mock.calls[0]![0];
      expect(dispatched.credentials).not.toHaveProperty("githubToken");
      expect(dispatched.credentials).not.toHaveProperty("githubLogin");
      expect(fixture.stash.mock.calls[0]![0].credentials).not.toHaveProperty("githubToken");
    });
  });

  describe("given a worker that answers as already running for the conversation", () => {
    /** @scenario "An unattended turn never borrows a running worker's key" */
    it("still mints a read-only key and carries it in the turn's handoff", async () => {
      const fixture = makeFixture({ workerRunning: true });

      await fixture.start(unattendedTurn);

      expect(fixture.mint).toHaveBeenCalledOnce();
      expect(fixture.mint).toHaveBeenCalledWith(expect.objectContaining({ ceiling: "unattended" }));
      expect(fixture.stash).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({
            langwatchApiKey: "session-key",
            langwatchApiKeyId: "key-1",
          }),
        }),
      );
    });

    it("lets a chat turn reuse the running worker's key", async () => {
      const fixture = makeFixture({ workerRunning: true });

      await fixture.start(chatTurn);

      expect(fixture.mint).not.toHaveBeenCalled();
    });
  });

  describe("given a person who holds no permission Langy may read with in the project", () => {
    /** @scenario "A person with no permission in the project is refused" */
    it("refuses with the scope code, starts no conversation and sends nothing to a worker", async () => {
      const keys = sessionKeysHolding(["organization:view", "prompts:update"]);
      const fixture = makeFixture({ sessionKeys: keys.service });

      await expect(fixture.start(unattendedTurn)).rejects.toMatchObject({
        code: "langy_insufficient_scope",
      });

      expect(keys.created).toEqual([]);
      expect(fixture.acceptTurn).not.toHaveBeenCalled();
      expect(fixture.stash).not.toHaveBeenCalled();
      expect(fixture.dispatch).not.toHaveBeenCalled();
      expect(fixture.abort).toHaveBeenCalledOnce();
    });
  });

  describe("given a person with Langy access", () => {
    /** @scenario "An unattended turn starts a new conversation marked as a run" */
    it("starts the conversation for them with the given title and the origin run", async () => {
      const fixture = makeFixture();

      await fixture.start(unattendedTurn);

      expect(fixture.acceptTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationStart: expect.objectContaining({
            userId: "user-1",
            title: RUN_TITLE,
            origin: "run",
          }),
        }),
      );
    });

    it("starts a chat conversation with no origin, so it folds as interactive", async () => {
      const fixture = makeFixture();

      await fixture.start(chatTurn);

      const accepted = fixture.acceptTurn.mock.calls[0]![0];
      expect(accepted.conversationStart).toMatchObject({ userId: "user-1", title: null });
      expect(accepted.conversationStart).not.toHaveProperty("origin");
    });
  });
});

describe("a turn in a run conversation", () => {
  describe("given a run conversation of a person, in a project with GitHub connected", () => {
    /** @scenario "A reply in a run conversation keeps the unattended ceiling" */
    it("mints the reply's key from the unattended allowlist and asks for no GitHub token", async () => {
      const keys = sessionKeysHolding([...LANGY_CANDIDATE_PERMISSIONS]);
      const github = credentialsWithGithub();
      const fixture = makeFixture({
        sessionKeys: keys.service,
        credentials: github.credentials,
        existing: RUN_CONVERSATION,
      });

      await fixture.start(replyIn("conversation-1"));

      expect(keys.created).toEqual([[...LANGY_UNATTENDED_PERMISSIONS]]);
      expect(keys.created[0]).not.toContain("prompts:update");
      expect(fixture.mint).toHaveBeenCalledWith(expect.objectContaining({ ceiling: "unattended" }));
      expect(github.findTurnTokens).not.toHaveBeenCalled();
      const dispatched = fixture.dispatch.mock.calls[0]![0];
      expect(dispatched.credentials).not.toHaveProperty("githubToken");
      expect(dispatched.credentials).not.toHaveProperty("githubLogin");
      expect(fixture.stash.mock.calls[0]![0].credentials).not.toHaveProperty("githubToken");
    });

    it("starts no new conversation for the reply, so the conversation stays a run", async () => {
      const fixture = makeFixture({ existing: RUN_CONVERSATION });

      await fixture.start(replyIn("conversation-1"));

      expect(fixture.acceptTurn.mock.calls[0]![0]).not.toHaveProperty("conversationStart");
    });

    /** @scenario "A person continues with full powers in a new conversation" */
    it("mints the full ceiling and the GitHub token for a chat turn in a new conversation", async () => {
      const keys = sessionKeysHolding([...LANGY_CANDIDATE_PERMISSIONS]);
      const github = credentialsWithGithub();
      const fixture = makeFixture({ sessionKeys: keys.service, credentials: github.credentials });

      await fixture.start(chatTurn);

      expect(keys.created).toEqual([[...LANGY_CANDIDATE_PERMISSIONS]]);
      expect(fixture.dispatch.mock.calls[0]![0].credentials).toMatchObject({
        githubToken: "gh-token",
      });
    });

    it("keeps the full ceiling for a reply in a chat conversation", async () => {
      const keys = sessionKeysHolding([...LANGY_CANDIDATE_PERMISSIONS]);
      const github = credentialsWithGithub();
      const fixture = makeFixture({
        sessionKeys: keys.service,
        credentials: github.credentials,
        existing: { origin: "interactive" },
      });

      await fixture.start(replyIn("conversation-1"));

      expect(keys.created).toEqual([[...LANGY_CANDIDATE_PERMISSIONS]]);
      expect(github.findTurnTokens).toHaveBeenCalled();
    });

    it("keeps the unattended ceiling when the conversation's row can no longer be read", async () => {
      const github = credentialsWithGithub();
      const fixture = makeFixture({ credentials: github.credentials, existing: null });

      await fixture.start(replyIn("conversation-1"));

      expect(fixture.mint).toHaveBeenCalledWith(expect.objectContaining({ ceiling: "unattended" }));
      expect(github.findTurnTokens).not.toHaveBeenCalled();
    });
  });

  describe("given a run conversation whose worker answers as already running", () => {
    /** @scenario "A reply in a run conversation never borrows a running worker's key" */
    it("still mints the reply a key of its own, and carries it in the handoff", async () => {
      const fixture = makeFixture({ workerRunning: true, existing: RUN_CONVERSATION });

      await fixture.start(replyIn("conversation-1"));

      expect(fixture.mint).toHaveBeenCalledOnce();
      expect(fixture.mint).toHaveBeenCalledWith(expect.objectContaining({ ceiling: "unattended" }));
      expect(fixture.stash).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: expect.objectContaining({ langwatchApiKey: "session-key" }),
        }),
      );
    });

    it("lets a reply in a chat conversation reuse the running worker's key", async () => {
      const fixture = makeFixture({ workerRunning: true, existing: { origin: "interactive" } });

      await fixture.start(replyIn("conversation-1"));

      expect(fixture.mint).not.toHaveBeenCalled();
    });
  });

  describe("given a person who opens a run conversation", () => {
    /** @scenario "Opening a run conversation warms a worker with the unattended ceiling" */
    it("warms the worker with an allowlisted key and no GitHub token", async () => {
      const github = credentialsWithGithub();
      const fixture = makeFixture({ credentials: github.credentials, existing: RUN_CONVERSATION });

      await expect(fixture.warmUp("conversation-1")).resolves.toEqual({
        conversationId: "conversation-1",
        warmed: true,
      });

      expect(fixture.mint).toHaveBeenCalledWith(expect.objectContaining({ ceiling: "unattended" }));
      expect(github.findTurnTokens).not.toHaveBeenCalled();
      expect(fixture.warm.mock.calls[0]![0].credentials).not.toHaveProperty("githubToken");
    });

    it("warms a chat conversation's worker with the full ceiling", async () => {
      const fixture = makeFixture({ existing: { origin: "interactive" } });

      await fixture.warmUp("conversation-1");

      expect(fixture.mint).toHaveBeenCalledOnce();
      expect(fixture.mint.mock.calls[0]![0]).not.toHaveProperty("ceiling");
    });
  });
});

describe("a turn that only reads, and the channels around it", () => {
  describe("given a project with UI actions released", () => {
    /** @scenario "A turn in a run conversation is offered no UI action" */
    it.each([
      ["an unattended turn", { turn: unattendedTurn, existing: undefined }],
      [
        "a reply in a run conversation",
        { turn: replyIn("conversation-1"), existing: RUN_CONVERSATION },
      ],
    ])("renders the prompt of %s with the UI-action channel closed", async (_what, given) => {
      const fixture = makeFixture({ existing: given.existing });

      await fixture.start(given.turn);

      expect(fixture.render).toHaveBeenCalledWith(
        expect.objectContaining({ isUiActionSurfaceOpen: false }),
      );
    });

    it("still offers a chat turn the channel the project released", async () => {
      const fixture = makeFixture();

      await fixture.start(chatTurn);

      expect(fixture.render).toHaveBeenCalledWith(
        expect.objectContaining({ isUiActionSurfaceOpen: true }),
      );
    });
  });

  describe("given a project whose turns are mirrored with their content", () => {
    /** @scenario "A turn in a run conversation is not copied to the operator's mirror" */
    it.each([
      ["an unattended turn", { turn: unattendedTurn, existing: undefined }],
      [
        "a reply in a run conversation",
        { turn: replyIn("conversation-1"), existing: RUN_CONVERSATION },
      ],
    ])("hands the worker of %s the mirror tier skip", async (_what, given) => {
      const fixture = makeFixture({ existing: given.existing });

      await fixture.start(given.turn);

      expect(fixture.dispatch.mock.calls[0]![0]).toMatchObject({
        credentials: { mirrorTier: "skip" },
      });
      expect(fixture.stash.mock.calls[0]![0].credentials.mirrorTier).toBe("skip");
    });

    it("keeps a chat turn's mirror tier", async () => {
      const fixture = makeFixture();

      await fixture.start(chatTurn);

      expect(fixture.dispatch.mock.calls[0]![0]).toMatchObject({
        credentials: { mirrorTier: "content" },
      });
    });
  });
});

describe("the window an unattended turn is counted in", () => {
  describe("given an unattended turn that was already started", () => {
    /** @scenario "A retried unattended turn is counted once" */
    it("answers the same turn for a replay and counts nothing", async () => {
      const { turn, countTurn } = unattended();
      const fixture = makeFixture({ admission: "replay" });

      await expect(fixture.start(turn)).resolves.toEqual({
        conversationId: "conversation-1",
        turnId: "turn-1",
      });

      expect(countTurn).not.toHaveBeenCalled();
      expect(fixture.mint).not.toHaveBeenCalled();
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });

    it("counts a turn once when it is first claimed, before anything is minted", async () => {
      const { turn, countTurn } = unattended();
      const fixture = makeFixture();
      countTurn.mockImplementation(async () => {
        expect(fixture.mint).not.toHaveBeenCalled();
      });

      await fixture.start(turn);

      expect(countTurn).toHaveBeenCalledOnce();
      expect(fixture.mint).toHaveBeenCalledOnce();
    });
  });

  describe("given a project whose unattended turns reached their window", () => {
    it("abandons the claim and mints, records and dispatches nothing", async () => {
      const { turn, countTurn } = unattended();
      countTurn.mockRejectedValue(new LangyTurnsRateLimitedError({ retryAfterSeconds: 60 }));
      const fixture = makeFixture();

      await expect(fixture.start(turn)).rejects.toMatchObject({ code: "langy_turns_rate_limited" });

      expect(fixture.abort).toHaveBeenCalledOnce();
      expect(fixture.mint).not.toHaveBeenCalled();
      expect(fixture.acceptTurn).not.toHaveBeenCalled();
      expect(fixture.stash).not.toHaveBeenCalled();
      expect(fixture.dispatch).not.toHaveBeenCalled();
    });
  });
});
