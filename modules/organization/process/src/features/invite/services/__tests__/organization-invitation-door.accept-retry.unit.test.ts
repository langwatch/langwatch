/**
 * @vitest-environment node
 * Joining again on a spent invitation repairs its grants for the person who spent it,
 * and only for them.
 * @see ../../../../../../../../specs/licensing/billing-only-invite.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";

function doorOver({ acceptedByUserId }: { acceptedByUserId: string }) {
  const invite = {
    id: "invite-1",
    email: "finance@acme.com",
    inviteCode: "code-1",
    status: "ACCEPTED",
    role: "EXTERNAL",
    billingOnly: true,
    acceptedByUserId,
    organizationId: "org-1",
    organization: { id: "org-1", name: "Acme" },
  };
  const apply = vi.fn(async () => {});
  const announceJoin = vi.fn(async () => {});
  const service = OrganizationInvitationDoorService.create({
    billing: { createSeatCheckout: vi.fn() },
    getOldestTeamId: vi.fn(),
    invitations: createApiFixture<OrganizationInvitations>({
      findByCode: vi.fn(async () => invite),
      apply,
    } as never),
    directory: { findProvenAddresses: vi.fn(async () => []) },
    signals: createApiFixture<OrganizationSignals>({ announceJoin, reportError: vi.fn() }),
    lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: vi.fn(async () => {}) },
    ensurePersonalWorkspace: vi.fn(async () => undefined),
  } as never);
  return { service, invite, apply, announceJoin };
}

const FINANCE = { id: "user-finance", name: "Finance", email: "finance@acme.com" } as never;

describe("given an invitation already accepted", () => {
  describe("when the person who accepted it joins again", () => {
    /** @scenario "Accepting a Billing-only invite takes no seat" */
    it("re-applies the invitation's grants, then answers that it was accepted", async () => {
      const { service, invite, apply, announceJoin } = doorOver({
        acceptedByUserId: "user-finance",
      });

      await expect(service.accept({ inviteCode: "code-1" }, FINANCE)).rejects.toMatchObject({
        code: "invite_already_accepted",
      });

      expect(apply).toHaveBeenCalledWith({ userId: "user-finance", invite });
      expect(announceJoin).not.toHaveBeenCalled();
    });
  });

  describe("when someone else joins with the same link", () => {
    it("applies nothing", async () => {
      const { service, apply } = doorOver({ acceptedByUserId: "user-other" });

      await expect(service.accept({ inviteCode: "code-1" }, FINANCE)).rejects.toMatchObject({
        code: "invite_already_accepted",
      });

      expect(apply).not.toHaveBeenCalled();
    });
  });
});
