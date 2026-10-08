/**
 * @vitest-environment node
 * @unit
 * @see modules/organization/specs/invitations.feature
 */
import type { OrganizationCaller, OrganizationInvite } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";
import type { OrganizationLifecycleNoticeService } from "../organization-lifecycle-notice.service.ts";
import type { OrganizationSignals } from "../organization-signals.service.ts";

const CALLER: OrganizationCaller = { id: "user-ana", name: "Ana", email: "ana@acme.test" };

function inviteFor({ id, email }: { id: string; email: string }): OrganizationInvite {
  return {
    id,
    email,
    inviteCode: `code-${id}`,
    expiration: null,
    status: "PENDING",
    organizationId: "org-1",
    teamIds: "",
    teamAssignments: null,
    role: "MEMBER",
    requestedBy: "user-ana",
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: Temporal.Instant.fromEpochMilliseconds(1_000),
    updatedAt: Temporal.Instant.fromEpochMilliseconds(1_000),
  };
}

function doorWith({
  accounts,
  lookupFails = false,
}: {
  accounts: Record<string, string>;
  lookupFails?: boolean;
}) {
  const membersInvited = vi.fn<OrganizationLifecycleNoticeService["membersInvited"]>();
  const reportError = vi.fn();
  const create = vi.fn(async () => ({
    organization: { id: "org-1", members: [] },
    invites: [
      { invite: inviteFor({ id: "invite-sam", email: "sam@acme.test" }) },
      { invite: inviteFor({ id: "invite-kim", email: "kim@acme.test" }) },
    ],
  }));
  const findUserIdByEmail = vi.fn(async ({ email }: { email: string }) => {
    if (lookupFails) throw new Error("user directory unavailable");
    return accounts[email] ?? null;
  });
  const service = OrganizationInvitationDoorService.create({
    invitations: createApiFixture<OrganizationInvitations>({
      create: create as never,
      findUserIdByEmail,
      acceptUrl: (code: string) => `https://app.test/invite/${code}`,
    }),
    directory: { findProvenAddresses: async () => [] },
    signals: createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn(), reportError }),
    lifecycle: { membersInvited, inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: vi.fn(async () => {}) },
    ensurePersonalWorkspace: vi.fn(async () => undefined),
  });
  return { service, membersInvited, reportError };
}

const BATCH = {
  organizationId: "org-1",
  validation: "lenient" as const,
  invites: [
    { email: "sam@acme.test", role: "MEMBER" as const, teams: [] },
    { email: "kim@acme.test", role: "MEMBER" as const, teams: [] },
  ],
};

describe("given an administrator inviting a batch", () => {
  describe("when one invitee already holds an account", () => {
    /** @scenario An invitation batch names the invitees who already hold an account */
    it("names that invitee, and only that invitee, on the batch's fact", async () => {
      const { service, membersInvited } = doorWith({
        accounts: { "sam@acme.test": "user-sam" },
      });

      await service.create(BATCH, CALLER);

      expect(membersInvited).toHaveBeenCalledOnce();
      expect(membersInvited.mock.calls[0]?.[0]).toMatchObject({
        inviteIds: ["invite-sam", "invite-kim"],
        invitees: [{ inviteId: "invite-sam", userId: "user-sam" }],
      });
    });
  });

  describe("when looking up the invitees' accounts fails", () => {
    /** @scenario A failed invitee lookup still records the batch */
    it("records the batch naming no invitees and reports the failure", async () => {
      const { service, membersInvited, reportError } = doorWith({
        accounts: {},
        lookupFails: true,
      });

      const created = await service.create(BATCH, CALLER);

      expect(created).toHaveLength(2);
      expect(membersInvited.mock.calls[0]?.[0]).toMatchObject({ invitees: [] });
      expect(reportError).toHaveBeenCalledTimes(2);
    });
  });
});
