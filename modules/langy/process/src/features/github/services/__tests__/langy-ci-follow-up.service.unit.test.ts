/**
 * LangyCiFollowUpService over the memory pull request rows, the conversation's count of follow-ups
 * in a row and the memory turn admission: when finished checks start a follow-up turn, as whom,
 * with what message, and every case that starts none.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import { createTenantId } from "@langwatch/eventing";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GithubPullRequestChecksCompletedEventData } from "@langwatch/github-contract";
import {
  initLangyConversationState,
  LangyAgentUnavailableError,
  LangyIdempotencyMismatchError,
  LangyTurnInProgressError,
} from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { LangyMemoryStore } from "../../../../repositories/memory/langy-memory.store.ts";
import { MemoryLangyConversationProjectionRepository } from "../../../../repositories/memory/memory.langy-conversation-projection.repository.ts";
import { MemoryLangyPullRequestRepository } from "../../../../repositories/memory/memory.langy-pull-request.repository.ts";
import { MemoryLangyTurnAdmissionRepository } from "../../../../repositories/memory/memory.langy-turn-admission.repository.ts";
import { LANGY_CI_FOLLOW_UPS_IN_A_ROW } from "../../../../rules/langy-ci-follow-up.rules.ts";
import {
  LangyTurnSharedService,
  type StartConversationTurnInput,
} from "../../../turn/services/langy-turn-shared.service.ts";
import { LangyCiFollowUpService } from "../langy-ci-follow-up.service.ts";

const PROJECT_ID = "project-1";
const CONVERSATION_ID = "conversation-1";
const at = { tenantId: createTenantId(PROJECT_ID), aggregateId: CONVERSATION_ID };
const SHARED = LangyTurnSharedService.create();

function checks(
  over: Partial<GithubPullRequestChecksCompletedEventData> = {},
): GithubPullRequestChecksCompletedEventData {
  return {
    tenantId: "org-1",
    organizationId: "org-1",
    installationId: "4242",
    repositoryHost: "github.com",
    repositoryFullName: "acme/agent",
    headBranch: "langy/fix-citations",
    headSha: "abc123def4567890",
    pullRequestNumbers: [12],
    conclusion: "failure",
    failedChecks: [{ name: "unit", conclusion: "failure", url: "https://github.com/x/runs/1" }],
    occurredAt: 0,
    ...over,
  };
}

const owner = (over: { deactivatedAt?: Date | null } = {}) => ({
  id: "user-1",
  name: "Ada",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  lastLoginAt: null,
  deactivatedAt: over.deactivatedAt ?? null,
});

function projection<T>(state: T) {
  return {
    state,
    cursor: { acceptedAt: 1, eventId: "evt-1" },
    occurredAt: 1,
    createdAt: 1,
    updatedAt: 1,
    version: "test",
  };
}

/**
 * The turn start as the follow-up sees it, over the real memory admission: the idempotency key
 * replays a committed turn, refuses a reused key with another message, and a conversation
 * holding another turn answers busy.
 */
class AdmittedTurns {
  readonly started: StartConversationTurnInput[] = [];

  constructor(private readonly admission: MemoryLangyTurnAdmissionRepository) {}

  async startCiFollowUpTurn(input: StartConversationTurnInput) {
    const userId = input.session.user.id;
    const conversationId = input.requestedConversationId ?? CONVERSATION_ID;
    const { turnId } = SHARED.langyTurnIdentity({
      userId,
      idempotencyKey: input.idempotencyKey,
      messages: input.messages,
    });
    const claim = { projectId: input.projectId, userId, idempotencyKey: input.idempotencyKey };
    const admitted = await this.admission.claim({ ...claim, conversationId, turnId });
    if (admitted.kind === "replay") return { conversationId, turnId };
    if (admitted.kind === "mismatch") throw new LangyIdempotencyMismatchError();
    if (admitted.kind === "busy") throw new LangyTurnInProgressError();
    if (admitted.kind === "pending") throw new LangyAgentUnavailableError();
    await this.admission.commit({
      ...claim,
      conversationId,
      turnId,
      claimToken: admitted.claimToken,
    });
    this.started.push(input);
    await this.admission.release({ projectId: input.projectId, conversationId, turnId });
    return { conversationId, turnId };
  }
}

async function harness({
  openedInProjectOf = "org-1",
  deactivated = false,
  released = true,
  followUpsInARow = 0,
}: {
  openedInProjectOf?: string | null;
  deactivated?: boolean;
  released?: boolean;
  followUpsInARow?: number;
} = {}) {
  const store = LangyMemoryStore.create();
  const pullRequests = MemoryLangyPullRequestRepository.create(store);
  const conversations = MemoryLangyConversationProjectionRepository.create(store);
  const admission = MemoryLangyTurnAdmissionRepository.create(store);
  const seedConversation = (inARow: number) =>
    conversations.store(
      projection({
        ...initLangyConversationState(),
        ConversationId: CONVERSATION_ID,
        UserId: "user-1",
        CiFollowUpsInARow: inARow,
        CreatedAt: 1,
        UpdatedAt: 1,
        LastEventOccurredAt: 1,
      }),
      at,
    );
  await seedConversation(followUpsInARow);
  if (openedInProjectOf) {
    await pullRequests.append(
      {
        ConversationId: CONVERSATION_ID,
        PullRequests: [{ repositoryFullName: "acme/agent", prNumber: 12 }],
        OpenedAt: 0,
        SourceEventId: "evt-answer",
      },
      at,
    );
  }
  const turns = new AdmittedTurns(admission);
  const counted: string[] = [];
  const service = LangyCiFollowUpService.create({
    pullRequests,
    conversations,
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async ({ organizationId }) =>
        organizationId === openedInProjectOf ? [PROJECT_ID] : ["project-elsewhere"],
    }),
    users: createApiFixture<UserApi>({
      findById: async () => owner({ deactivatedAt: deactivated ? new Date(0) : null }),
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => released }),
    bounds: {
      assertUnattendedTurnWithinBounds: async ({ projectId }) => void counted.push(projectId),
    },
    turns,
  });
  return { turns, service, counted, admission, seedConversation };
}

const textOf = (input: StartConversationTurnInput) => {
  const part = input.messages[0]?.parts[0];
  return part?.type === "text" && typeof part.text === "string" ? part.text : "";
};

describe("LangyCiFollowUpService", () => {
  describe("given a pull request a conversation of a person with Langy access opened", () => {
    /** @scenario "Finished checks start a follow-up turn in the conversation that opened the pull request" */
    it("starts a turn in that conversation as that person, naming what CI reported", async () => {
      const { turns, service } = await harness();

      await service.handleChecksCompleted(checks());

      expect(turns.started).toHaveLength(1);
      const [turn] = turns.started;
      expect(turn).toMatchObject({
        projectId: PROJECT_ID,
        requestedConversationId: CONVERSATION_ID,
        idempotencyKey: "ci-follow-up:acme/agent#12@abc123def4567890",
        session: { user: { id: "user-1", email: "ada@example.com" } },
        ciFollowUp: { repositoryFullName: "acme/agent", prNumber: 12, headSha: "abc123def4567890" },
      });
      const text = textOf(turn!);
      expect(text).toContain("acme/agent#12");
      expect(text).toContain("langy/fix-citations");
      expect(text).toContain("abc123def456");
      expect(text).toContain("checks failed");
      expect(text).toContain("unit: failure");
      expect(text).toContain("started by LangWatch");
      expect(text).toContain(`Automatic follow-up 1 of at most ${LANGY_CI_FOLLOW_UPS_IN_A_ROW}`);
    });

    it("finds the pull request whatever the case of the repository name", async () => {
      const { turns, service } = await harness();

      await service.handleChecksCompleted(checks({ repositoryFullName: "Acme/Agent" }));

      expect(turns.started).toHaveLength(1);
    });

    it("counts the follow-up against the project's unattended bounds when the turn claims", async () => {
      const { turns, service, counted } = await harness();

      await service.handleChecksCompleted(checks());
      await turns.started[0]!.ciFollowUp!.countTurn();

      expect(counted).toEqual([PROJECT_ID]);
    });

    /** @scenario "The same commit wakes Langy once" */
    it("starts no second turn when the same commit is reported again", async () => {
      const { turns, service } = await harness();

      await service.handleChecksCompleted(checks());
      await service.handleChecksCompleted(checks());

      expect(turns.started).toHaveLength(1);
    });

    it("starts no second turn for the same commit once its follow-up was counted", async () => {
      const { turns, service, seedConversation } = await harness();

      await service.handleChecksCompleted(checks());
      await seedConversation(1);
      await service.handleChecksCompleted(checks());

      expect(turns.started).toHaveLength(1);
    });
  });

  describe("given checks on a pull request no conversation opened", () => {
    /** @scenario "A pull request no conversation opened wakes nothing" */
    it("starts no turn", async () => {
      const { turns, service } = await harness({ openedInProjectOf: null });

      await service.handleChecksCompleted(checks({ pullRequestNumbers: [7] }));

      expect(turns.started).toEqual([]);
    });
  });

  describe("given a pull request a conversation in another organization opened", () => {
    /** @scenario "A pull request opened in another organization wakes nothing" */
    it("starts no turn", async () => {
      const { turns, service } = await harness({ openedInProjectOf: "org-a" });

      await service.handleChecksCompleted(checks({ organizationId: "org-b", tenantId: "org-b" }));

      expect(turns.started).toEqual([]);
    });
  });

  describe("given the conversation already had the cap of follow-ups in a row", () => {
    /** @scenario "Follow-ups stop at the cap of automatic turns in a row" */
    it("starts no turn for a new commit", async () => {
      const { turns, service } = await harness({ followUpsInARow: LANGY_CI_FOLLOW_UPS_IN_A_ROW });

      await service.handleChecksCompleted(checks({ headSha: "new-commit" }));

      expect(turns.started).toEqual([]);
    });
  });

  describe("given an owner who may no longer act", () => {
    /** @scenario "A deactivated owner gets no follow-up" */
    it("starts no turn for a deactivated owner", async () => {
      const { turns, service } = await harness({ deactivated: true });

      await service.handleChecksCompleted(checks());

      expect(turns.started).toEqual([]);
    });

    /** @scenario "An owner without Langy access gets no follow-up" */
    it("starts no turn for an owner Langy is not released to", async () => {
      const { turns, service } = await harness({ released: false });

      await service.handleChecksCompleted(checks());

      expect(turns.started).toEqual([]);
    });
  });

  describe("given a conversation busy with another turn", () => {
    /** @scenario "A conversation busy with another turn is retried later" */
    it("fails the delivery and leaves the commit able to wake Langy again", async () => {
      const { turns, service, admission } = await harness();
      const other = { projectId: PROJECT_ID, userId: "user-1", conversationId: CONVERSATION_ID };
      await admission.claim({ ...other, idempotencyKey: "the-person", turnId: "turn-person" });

      const failure = await service.handleChecksCompleted(checks()).catch((error) => error);

      expect(failure).toMatchObject({ code: "langy_turn_in_progress" });
      await admission.release({ projectId: PROJECT_ID, conversationId: CONVERSATION_ID });
      await service.handleChecksCompleted(checks());
      expect(turns.started).toHaveLength(1);
    });
  });
});
