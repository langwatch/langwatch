import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { LangyPanelAccessService } from "../langy-panel-access.service.ts";
import {
  LangyPanelConversationService,
  type LangyPanelConversationMembers,
} from "../langy-panel-conversation.service.ts";
import {
  LangyPanelLocalService,
  type LangyPanelLocalMembers,
} from "../langy-panel-local.service.ts";

type UiActions = NonNullable<LangyPanelConversationMembers["uiActions"]>;

const caller = { userId: "user_1", name: "Ada", email: "ada@example.com" };
const projectId = "project_1";

function access({ enabled = true, demo = false } = {}): LangyPanelAccessService {
  return LangyPanelAccessService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => enabled }),
    projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "org_1" }),
    authz: createApiFixture<AuthzApi>({ isDemoProject: () => demo }),
  });
}

function panel(
  overrides: Partial<LangyPanelConversationMembers> = {},
): LangyPanelConversationService {
  return LangyPanelConversationService.create({
    access: access(),
    langy: createApiFixture<LangyPanelConversationMembers["langy"]>(),
    turnBounds: createApiFixture<LangyPanelConversationMembers["turnBounds"]>(),
    rateLimiter: { check: async () => ({ allowed: true }) },
    presence: createApiFixture<PresenceApi>(),
    turnAccess: null,
    openBuffer: null,
    uiActions: null,
    ...overrides,
  });
}

describe("LangyPanelConversationService", () => {
  /** @scenario "A person outside the Langy rollout is answered not enabled" */
  it("refuses a person outside the rollout before reading anything", async () => {
    const service = panel({ access: access({ enabled: false }) });

    await expect(service.listConversations({ caller, projectId, limit: 30 })).rejects.toMatchObject(
      { code: "langy_not_enabled" },
    );
  });

  /** @scenario "The demo project never runs Langy" */
  it("refuses the demo project", async () => {
    const service = panel({ access: access({ demo: true }) });

    await expect(service.listConversations({ caller, projectId, limit: 30 })).rejects.toMatchObject(
      { code: "langy_not_enabled" },
    );
  });

  /** @scenario "The conversation list reaches the browser as epoch-millisecond rows" */
  it("answers the list as epoch-millisecond rows", async () => {
    const service = panel({
      langy: createApiFixture<LangyPanelConversationMembers["langy"]>({
        getPage: async () => ({
          items: [
            {
              id: "conversation_1",
              title: "Why is my agent slow",
              isShared: false,
              isOwn: true,
              messageCount: 2,
              lastActivityAt: Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000),
            },
          ],
          nextCursor: null,
        }),
      }),
    });

    const page = await service.listConversations({ caller, projectId, limit: 30 });

    expect(page.items).toEqual([
      {
        id: "conversation_1",
        title: "Why is my agent slow",
        isShared: false,
        isOwn: true,
        messageCount: 2,
        lastActivityAtMs: 1_700_000_000_000,
      },
    ]);
  });

  /** @scenario "A conversation that is not visible yet reads as absent" */
  it("answers an unprojected conversation's detail as empty", async () => {
    const service = panel({
      langy: createApiFixture<LangyPanelConversationMembers["langy"]>({
        findByIdVisible: async () => null,
      }),
    });

    await expect(
      service.findVisibleConversationDetails({ caller, projectId, conversationId: "c_1" }),
    ).resolves.toEqual([]);
  });

  /** @scenario "A person over the message budget is refused before a turn dispatches" */
  it("refuses a send over the message budget before any turn starts", async () => {
    const service = panel({ rateLimiter: { check: async () => ({ allowed: false }) } });

    await expect(
      service.continueConversationTurn({
        caller,
        projectId,
        conversationId: "conversation_1",
        idempotencyKey: "send-0001",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      }),
    ).rejects.toMatchObject({ code: "langy_rate_limited" });
  });

  /** @scenario "A panel-open warm over its budget is a cold start, never an error" */
  it("answers an over-budget warm as a cold start", async () => {
    const service = panel({ rateLimiter: { check: async () => ({ allowed: false }) } });

    await expect(
      service.warmPanelWorker({ caller, projectId, conversationId: "conversation_1" }),
    ).resolves.toEqual({ conversationId: "conversation_1", warmed: false });
  });

  /** @scenario "A tab cannot claim an action in a conversation it cannot see" */
  it("answers a claim in an invisible conversation as not claimed", async () => {
    const service = panel({
      langy: createApiFixture<LangyPanelConversationMembers["langy"]>({
        findByIdVisible: async () => null,
      }),
      uiActions: createApiFixture<UiActions>(),
    });

    await expect(
      service.claimUiAction({ caller, projectId, conversationId: "c_1", actionId: "a_1" }),
    ).resolves.toEqual({ isClaimed: false });
  });

  /** @scenario "A tab's completion reaches the action as the signed-in person's" */
  it("hands the completion on under the caller's id", async () => {
    const seen: Parameters<UiActions["complete"]>[0][] = [];
    const service = panel({
      uiActions: createApiFixture<UiActions>({
        complete: async (args) => {
          seen.push(args);
          return { isAccepted: true };
        },
      }),
    });

    await expect(
      service.completeUiAction({
        caller,
        projectId,
        conversationId: "c_1",
        actionId: "a_1",
        ok: true,
        result: { rows: 2 },
      }),
    ).resolves.toEqual({ isAccepted: true });
    expect(seen).toEqual([
      {
        projectId,
        userId: "user_1",
        conversationId: "c_1",
        actionId: "a_1",
        completion: { ok: true, result: { rows: 2 } },
      },
    ]);
  });
});

describe("LangyPanelLocalService", () => {
  /** @scenario "Remembering the code access choice writes it for the signed-in person" */
  it("writes the remembered choice for the caller", async () => {
    const written: { userId: string; preference: "github" | null }[] = [];
    const service = LangyPanelLocalService.create({
      access: access(),
      conversations: createApiFixture<LangyPanelLocalMembers["conversations"]>(),
      runtime: createApiFixture<LangyPanelLocalMembers["runtime"]>(),
      commands: createApiFixture<LangyPanelLocalMembers["commands"]>(),
      workspace: createApiFixture<LangyPanelLocalMembers["workspace"]>({
        setCodeAccessPreference: async (input) => {
          written.push(input);
          return { preference: input.preference };
        },
      }),
      projects: createApiFixture<ProjectApi>(),
      baseHost: undefined,
    });

    await expect(
      service.setCodeAccessPreference({ caller, projectId, preference: "github" }),
    ).resolves.toEqual({ preference: "github" });
    expect(written).toEqual([{ userId: "user_1", preference: "github" }]);
  });
});
