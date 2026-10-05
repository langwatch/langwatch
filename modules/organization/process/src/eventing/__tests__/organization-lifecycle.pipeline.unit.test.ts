/**
 * @vitest-environment node
 *
 * organization_lifecycle: the api records a sign-up, an invitation batch, an acceptance and a
 * chosen integration method, ids only; nurturing reacts from its own side (ARCHITECTURE §9).
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  RecordIntegrationMethodChosenCommand,
  RecordInviteAcceptedCommand,
  RecordMembersInvitedCommand,
  RecordPresenceSettingChangedCommand,
  RecordSignedUpCommand,
} from "../organization-lifecycle.commands.ts";
import { buildOrganizationLifecyclePipeline } from "../organization-lifecycle.pipeline.ts";

const AT = Date.UTC(2026, 8, 29, 12);
const envelope = { tenantId: "org_acme", organizationId: "org_acme", occurredAt: AT };

function command<Data>(data: Data) {
  return { tenantId: createTenantId("org_acme"), aggregateId: "org_acme", type: "record", data };
}

function only<T>(events: T[]): T {
  const [event] = events;
  if (!event) throw new Error("the command recorded no event");
  return event;
}

const invited = only(
  new RecordMembersInvitedCommand().handle(
    command({
      ...envelope,
      userId: "user_admin",
      inviteIds: ["invite_1", "invite_2"],
      roles: ["MEMBER", "ADMIN"],
      teamMemberCount: 4,
    }),
  ),
);
const signedUp = only(
  new RecordSignedUpCommand().handle(
    command({
      ...envelope,
      userId: "user_admin",
      organizationName: "Acme",
      signUpData: { yourRole: "engineer" },
      primaryIntent: "LLM_OPS",
    }),
  ),
);
const accepted = only(
  new RecordInviteAcceptedCommand().handle(
    command({
      ...envelope,
      userId: "user_new",
      inviteId: "invite_1",
      organizationName: "Acme",
    }),
  ),
);

const chosen = only(
  new RecordIntegrationMethodChosenCommand().handle({
    tenantId: createTenantId("user_admin"),
    aggregateId: "user_admin",
    type: "record",
    data: {
      tenantId: "user_admin",
      userId: "user_admin",
      occurredAt: AT,
      selection: "via-platform",
    },
  }),
);

describe("organization's lifecycle pipeline", () => {
  it("keys each event by what it records, so a resent command records nothing new", () => {
    expect(signedUp.idempotencyKey).toBe("org_acme:signed_up");
    expect(invited.idempotencyKey).toBe("org_acme:invited:invite_1,invite_2");
    expect(accepted.idempotencyKey).toBe("org_acme:invite_1:accepted");
    expect(chosen.idempotencyKey).toBe(`user_admin:integration_method:${AT}`);
  });

  it("keys an integration method by the person who chose it", () => {
    expect(chosen.aggregateId).toBe("user_admin");
  });

  it("declares no subscriber of its own: its peers react from their side", () => {
    expect(buildOrganizationLifecyclePipeline().eventSubscribers.size).toBe(0);
  });

  describe("when the organization's presence setting is recorded", () => {
    const presence = (data: { occurredAt: number; backfilled?: boolean }) =>
      only(
        new RecordPresenceSettingChangedCommand().handle(
          command({
            ...envelope,
            presenceEnabled: false,
            ...(data.backfilled ? { backfilled: true } : { changedByUserId: "user_admin" }),
            occurredAt: data.occurredAt,
          }),
        ),
      );

    /** @scenario "A changed organization presence setting is recorded as organization's fact" */
    it("records a change on the organization, carrying who changed it, keyed on its moment", () => {
      const first = presence({ occurredAt: AT });
      const second = presence({ occurredAt: AT + 1 });

      expect(first.type).toBe(ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE);
      expect(first.aggregateId).toBe("org_acme");
      expect(first.data).toMatchObject({ presenceEnabled: false, changedByUserId: "user_admin" });
      expect(first.data.backfilled).toBeUndefined();
      expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    });

    /** @scenario "Existing organizations' presence settings are recorded by the backfill, idempotently" */
    it("keys a backfilled setting once per organization, so a re-run collapses", () => {
      const first = presence({ occurredAt: AT, backfilled: true });
      const rerun = presence({ occurredAt: AT + 1, backfilled: true });

      expect(first.idempotencyKey).toBe("org_acme:presence_setting:backfilled");
      expect(rerun.idempotencyKey).toBe(first.idempotencyKey);
    });
  });
});
