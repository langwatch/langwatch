/**
 * The door a module starts an unattended turn through: every refusal comes before anything is
 * counted, claimed or started, and the count is the turn's to make once it is claimed.
 * @vitest-environment node
 * @see modules/langy/specs/langy-unattended-turn.feature
 */
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { LangyActorUserReader } from "../../../../services/langy-actor-session.service.ts";
import type { StartConversationTurnInput } from "../langy-turn-shared.service.ts";
import { LangyUnattendedTurnService } from "../langy-unattended-turn.service.ts";

const PROJECT_ID = "project-1";
const USER_ID = "user-1";

const users = ({
  found,
  deactivated,
}: {
  found: boolean;
  deactivated: boolean;
}): LangyActorUserReader => ({
  findById: async ({ id }) =>
    found
      ? {
          id,
          name: "Riley",
          email: "riley@example.test",
          emailVerified: true,
          image: null,
          pendingSsoSetup: false,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          lastLoginAt: null,
          deactivatedAt: deactivated ? new Date(0) : null,
        }
      : null,
});

function harness({
  userExists = true,
  deactivated = false,
  kind = "application",
  langyReleased = true,
  replay = false,
}: {
  userExists?: boolean;
  deactivated?: boolean;
  kind?: string;
  langyReleased?: boolean;
  /** The turn below answers a turn it already took, as it does for a retried run. */
  replay?: boolean;
} = {}) {
  const counted: string[] = [];
  const started: StartConversationTurnInput[] = [];
  const service = LangyUnattendedTurnService.create({
    users: users({ found: userExists, deactivated }),
    projects: createApiFixture<Pick<ProjectApi, "findIdentity">>({
      findIdentity: async (id) => ({
        id,
        name: "Shop",
        slug: "shop",
        teamId: "team-1",
        organizationId: "organization-1",
        isPersonal: false,
        ownerUserId: null,
        kind,
      }),
    }),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => langyReleased }),
    bounds: {
      assertUnattendedTurnWithinBounds: async ({ projectId }) => void counted.push(projectId),
    },
    turns: {
      startUnattendedTurn: async (input) => {
        started.push(input);
        // The turn counts itself once it is claimed; a replay is answered before that.
        if (!replay) await input.unattended.countTurn();
        return { conversationId: "conversation-1", turnId: "turn-1" };
      },
    },
  });
  const start = () =>
    service.start({
      projectId: PROJECT_ID,
      userId: USER_ID,
      idempotencyKey: "insight-daily-run:schedule-1:run-1",
      text: "Read the board.",
      title: "Daily insights - Costs - 2026-10-09",
    });
  return { start, counted, started };
}

describe("LangyUnattendedTurnService", () => {
  describe("given a person with Langy access in an application project", () => {
    /** @scenario "An unattended turn starts a new conversation marked as a run" */
    it("starts a turn as that person, in a conversation of its own, under the given title", async () => {
      const { start, counted, started } = harness();

      await expect(start()).resolves.toEqual({
        conversationId: "conversation-1",
        turnId: "turn-1",
      });

      expect(counted).toEqual([PROJECT_ID]);
      expect(started).toEqual([
        {
          projectId: PROJECT_ID,
          idempotencyKey: "insight-daily-run:schedule-1:run-1",
          session: { user: { id: USER_ID, name: "Riley", email: "riley@example.test" } },
          requestedConversationId: null,
          messages: [{ role: "user", parts: [{ type: "text", text: "Read the board." }] }],
          isRetry: false,
          turnContext: {},
          unattended: {
            title: "Daily insights - Costs - 2026-10-09",
            countTurn: expect.any(Function),
          },
        },
      ]);
    });

    it("counts nothing itself when the turn below answers a replay", async () => {
      const { start, counted, started } = harness({ replay: true });

      await start();

      expect(started).toHaveLength(1);
      expect(counted).toEqual([]);
    });
  });

  describe("given a person whose account was deactivated", () => {
    /** @scenario "A deactivated person is refused an unattended turn" */
    it("refuses before any turn is counted or started", async () => {
      const { start, counted, started } = harness({ deactivated: true });

      await expect(start()).rejects.toMatchObject({ code: "langy_unattended_actor_deactivated" });

      expect(counted).toEqual([]);
      expect(started).toEqual([]);
    });
  });

  describe("given a user id no user has", () => {
    /** @scenario "A person who no longer exists is refused an unattended turn" */
    it("refuses before any turn is counted or started", async () => {
      const { start, counted, started } = harness({ userExists: false });

      await expect(start()).rejects.toMatchObject({ code: "langy_unattended_actor_missing" });

      expect(counted).toEqual([]);
      expect(started).toEqual([]);
    });
  });

  describe("given a person Langy is not released to in the project", () => {
    /** @scenario "A person without Langy access is refused an unattended turn" */
    it("refuses before any turn is counted or started", async () => {
      const { start, counted, started } = harness({ langyReleased: false });

      await expect(start()).rejects.toMatchObject({ code: "langy_unattended_no_langy_access" });

      expect(counted).toEqual([]);
      expect(started).toEqual([]);
    });
  });

  describe("given an aggregate project", () => {
    /** @scenario "An aggregate project takes no unattended turn" */
    it("refuses before any turn is counted or claimed", async () => {
      const { start, counted, started } = harness({ kind: "aggregate" });

      await expect(start()).rejects.toMatchObject({ code: "aggregate_project_is_read_only" });

      expect(counted).toEqual([]);
      expect(started).toEqual([]);
    });
  });
});
