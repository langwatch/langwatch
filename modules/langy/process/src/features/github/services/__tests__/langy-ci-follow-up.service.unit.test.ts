/**
 * LangyCiFollowUpService over the memory link store: when finished checks on a pull request
 * start a follow-up turn, as whom, with what message, and every case that starts none.
 * @see modules/langy/specs/langy-ci-follow-up.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GithubPullRequestChecksCompletedEventData } from "@langwatch/github-contract";
import { LangyTurnInProgressError } from "@langwatch/langy-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { LangyPullRequestLinkMemoryRepository } from "../../../../repositories/memory/memory.langy-pull-request-link.repository.ts";
import { LANGY_CI_FOLLOW_UPS_IN_A_ROW } from "../../../../rules/langy-ci-follow-up.rules.ts";
import type { StartConversationTurnInput } from "../../../turn/services/langy-turn-shared.service.ts";
import { LangyCiFollowUpService } from "../langy-ci-follow-up.service.ts";

const PULL_REQUEST = { repositoryFullName: "acme/agent", prNumber: 12 };

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

/** The turn service as the follow-up sees it: records each start, or refuses as told. */
class RecordingTurns {
  readonly started: StartConversationTurnInput[] = [];
  refusal: Error | null = null;

  async startCiFollowUpTurn(input: StartConversationTurnInput) {
    if (this.refusal) throw this.refusal;
    this.started.push(input);
    return { conversationId: "conversation-1", turnId: `turn-${this.started.length}` };
  }
}

async function harness({
  linkedIn = "org-1",
  deactivated = false,
  released = true,
}: { linkedIn?: string | null; deactivated?: boolean; released?: boolean } = {}) {
  const links = LangyPullRequestLinkMemoryRepository.create();
  if (linkedIn) {
    await links.link({
      ...PULL_REQUEST,
      organizationId: linkedIn,
      projectId: "project-1",
      conversationId: "conversation-1",
      userId: "user-1",
      linkedAt: 0,
    });
  }
  const turns = new RecordingTurns();
  const counted: string[] = [];
  const service = LangyCiFollowUpService.create({
    links,
    users: createApiFixture<UserApi>({
      findById: async () => owner({ deactivatedAt: deactivated ? new Date(0) : null }),
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => released }),
    bounds: {
      assertUnattendedTurnWithinBounds: async ({ projectId }) => void counted.push(projectId),
    },
    turns,
  });
  return { links, turns, service, counted };
}

const textOf = (input: StartConversationTurnInput) => {
  const part = input.messages[0]?.parts[0];
  return part?.type === "text" && typeof part.text === "string" ? part.text : "";
};

describe("LangyCiFollowUpService", () => {
  describe("given a pull request linked to a conversation of a person with Langy access", () => {
    /** @scenario "Finished checks start a follow-up turn in the conversation that opened the pull request" */
    it("starts a turn in that conversation as that person, naming what CI reported", async () => {
      const { turns, service } = await harness();

      await service.handleChecksCompleted(checks());

      expect(turns.started).toHaveLength(1);
      const [turn] = turns.started;
      expect(turn).toMatchObject({
        projectId: "project-1",
        requestedConversationId: "conversation-1",
        session: { user: { id: "user-1", email: "ada@example.com" } },
        ciFollowUp: { repositoryFullName: "acme/agent" },
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

    it("counts the follow-up against the project's unattended bounds when the turn claims", async () => {
      const { turns, service, counted } = await harness();

      await service.handleChecksCompleted(checks());
      await turns.started[0]!.ciFollowUp!.countTurn();

      expect(counted).toEqual(["project-1"]);
    });

    /** @scenario "The same commit wakes Langy once" */
    it("starts no second turn for the same commit", async () => {
      const { turns, service } = await harness();

      await service.handleChecksCompleted(checks());
      await service.handleChecksCompleted(checks());

      expect(turns.started).toHaveLength(1);
    });
  });

  describe("given checks on a pull request no conversation linked", () => {
    /** @scenario "A pull request no conversation opened wakes nothing" */
    it("starts no turn", async () => {
      const { turns, service } = await harness({ linkedIn: null });

      await service.handleChecksCompleted(checks({ pullRequestNumbers: [7] }));

      expect(turns.started).toEqual([]);
    });
  });

  describe("given a link made in another organization", () => {
    /** @scenario "A link from another organization wakes nothing" */
    it("starts no turn", async () => {
      const { turns, service } = await harness({ linkedIn: "org-a" });

      await service.handleChecksCompleted(checks({ organizationId: "org-b", tenantId: "org-b" }));

      expect(turns.started).toEqual([]);
    });
  });

  describe("given the pull request already had the cap of follow-ups in a row", () => {
    /** @scenario "Follow-ups stop at the cap of automatic turns in a row" */
    it("starts no turn for a new commit", async () => {
      const { links, turns, service } = await harness();
      for (let n = 0; n < LANGY_CI_FOLLOW_UPS_IN_A_ROW; n++) {
        await links.recordFollowUp({
          ...PULL_REQUEST,
          conversationId: "conversation-1",
          turnId: `earlier-${n}`,
        });
      }

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
      const { turns, service } = await harness();
      turns.refusal = new LangyTurnInProgressError();

      const failure = await service.handleChecksCompleted(checks()).catch((error) => error);

      expect(failure).toMatchObject({ code: "langy_turn_in_progress" });
      turns.refusal = null;
      await service.handleChecksCompleted(checks());
      expect(turns.started).toHaveLength(1);
    });
  });
});
