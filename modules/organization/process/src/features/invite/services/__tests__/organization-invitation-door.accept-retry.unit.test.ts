/**
 * @vitest-environment node
 * A spent invitation writes nothing when its link is used again, so access an admin changed
 * since stays changed. Accepting a Billing-only invitation provisions no personal workspace.
 * @see ../../../../../../../../specs/licensing/billing-only-invite.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";

function doorOver({
  status,
  billingOnly = true,
  role = "EXTERNAL",
}: {
  status: "ACCEPTED" | "PENDING";
  billingOnly?: boolean;
  role?: "EXTERNAL" | "ADMIN";
}) {
  const invite = {
    id: "invite-1",
    email: "finance@acme.com",
    inviteCode: "code-1",
    status,
    role,
    billingOnly,
    acceptedByUserId: status === "ACCEPTED" ? "user-finance" : null,
    organizationId: "org-1",
    organization: { id: "org-1", name: "Acme" },
  };
  const apply = vi.fn(async () => {});
  const ensurePersonalWorkspace = vi.fn(async () => undefined);
  const service = OrganizationInvitationDoorService.create({
    billing: { createSeatCheckout: vi.fn() },
    getOldestTeamId: vi.fn(),
    invitations: createApiFixture<OrganizationInvitations>({
      findByCode: vi.fn(async () => invite),
      displayStatus: vi.fn(() => status),
      matchToAcceptor: vi.fn(async () => ({ matches: true, viaIdentifierId: undefined })),
      apply,
      findLandingProjectSlug: vi.fn(async () => null),
    } as never),
    directory: { findProvenAddresses: vi.fn(async () => []) },
    signals: createApiFixture<OrganizationSignals>({
      announceJoin: vi.fn(async () => {}),
      reportError: vi.fn(),
    }),
    lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: vi.fn(async () => {}) },
    ensurePersonalWorkspace,
  } as never);
  return { service, apply, ensurePersonalWorkspace };
}

const FINANCE = { id: "user-finance", name: "Finance", email: "finance@acme.com" } as never;

describe("given a Billing-only invitation already accepted, whose Billing grant has since gone", () => {
  describe("when the person who accepted it uses the old link again", () => {
    /** @scenario "Using a spent invitation link again writes nothing" */
    it("answers that it was accepted and writes no grant", async () => {
      const { service, apply } = doorOver({ status: "ACCEPTED" });

      await expect(service.accept({ inviteCode: "code-1" }, FINANCE)).rejects.toMatchObject({
        code: "invite_already_accepted",
      });

      expect(apply).not.toHaveBeenCalled();
    });
  });
});

describe("given an admin invitation already accepted, whose holder was since demoted", () => {
  describe("when they use the old link again", () => {
    /** @scenario "Using a spent invitation link again writes nothing" */
    it("answers that it was accepted and gives no admin grant back", async () => {
      const { service, apply } = doorOver({
        status: "ACCEPTED",
        billingOnly: false,
        role: "ADMIN",
      });

      await expect(service.accept({ inviteCode: "code-1" }, FINANCE)).rejects.toMatchObject({
        code: "invite_already_accepted",
      });

      expect(apply).not.toHaveBeenCalled();
    });
  });
});

describe("given a pending Billing-only invitation", () => {
  describe("when its person accepts it", () => {
    /** @scenario "A Billing-only member is given no team, project or personal workspace" */
    it("admits them and provisions no personal workspace", async () => {
      const { service, apply, ensurePersonalWorkspace } = doorOver({ status: "PENDING" });

      const accepted = await service.accept({ inviteCode: "code-1" }, FINANCE);

      expect(accepted).toMatchObject({ billingOnly: true, project: null });
      expect(apply).toHaveBeenCalledOnce();
      expect(ensurePersonalWorkspace).not.toHaveBeenCalled();
    });
  });
});
