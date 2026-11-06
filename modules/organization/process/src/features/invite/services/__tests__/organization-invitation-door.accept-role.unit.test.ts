/**
 * @vitest-environment node
 * Accepting an invitation tells lifecycle which role the person joined with.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { OrganizationSignals } from "../../../../services/organization-signals.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import type { OrganizationInvitations } from "../organization-invitations.service.ts";

describe("given a person accepting an invitation that grants a Lite Member seat", () => {
  it("passes the invitation's role to lifecycle.inviteAccepted", async () => {
    const invite = {
      id: "invite-1",
      email: "sam@acme.com",
      inviteCode: "code-1",
      status: "PENDING",
      role: "EXTERNAL",
      organizationId: "org-1",
      organization: { id: "org-1", name: "Acme" },
    };
    const inviteAccepted = vi.fn();
    const service = OrganizationInvitationDoorService.create({
      billing: { createSeatCheckout: vi.fn() },
      getOldestTeamId: vi.fn(),
      invitations: createApiFixture<OrganizationInvitations>({
        findByCode: vi.fn(async () => invite),
        displayStatus: vi.fn(() => "PENDING"),
        matchToAcceptor: vi.fn(async () => ({ matches: true, viaIdentifierId: undefined })),
        apply: vi.fn(async () => {}),
        findLandingProjectSlug: vi.fn(async () => null),
      } as never),
      directory: { findProvenAddresses: vi.fn(async () => []) },
      signals: createApiFixture<OrganizationSignals>({
        announceJoin: vi.fn(async () => {}),
        reportError: vi.fn(),
      }),
      lifecycle: { membersInvited: vi.fn(), inviteAccepted },
      creationThrottle: { assertCreationAllowed: async () => {} },
      ceiling: { assertWithinCaller: vi.fn(async () => {}) },
      ensurePersonalWorkspace: vi.fn(async () => undefined),
    } as never);

    await service.accept({ inviteCode: "code-1" }, {
      id: "user-sam",
      name: "Sam",
      email: "sam@acme.com",
    } as never);

    expect(inviteAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-sam", inviteId: "invite-1", role: "EXTERNAL" }),
    );
  });
});
