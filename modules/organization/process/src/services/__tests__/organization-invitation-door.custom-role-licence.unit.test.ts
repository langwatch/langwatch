import { createApiFixture } from "@langwatch/api-fixture";
import { GrantExceedsCallerPermissionsError } from "@langwatch/authz-contract";
/**
 * @vitest-environment node
 * The inviter's ceiling bounds an invitation before it is stored. The custom-role plan
 * question is declared on the doors: transport/__tests__/custom-role-gate.trpc.declaration.
 */
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationInvitations,
  OrganizationPlanGate,
  OrganizationSignals,
} from "../../app/organization.members.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";

const ORGANIZATION_ID = "org-1";
const CALLER: OrganizationCaller = { id: "user-1", name: "Sam", email: "sam@acme.test" };

function door(options: { beyondCaller?: string[] }) {
  const create = vi.fn(async () => ({
    organization: { id: ORGANIZATION_ID, members: [] },
    invites: [],
  }));
  const createPaymentPending = vi.fn(async () => undefined);
  const invitations = createApiFixture<OrganizationInvitations>({ create, createPaymentPending });
  const plans = createApiFixture<OrganizationPlanGate>({});
  const signals = createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() });

  const assertWithinCaller = vi.fn(async () => {
    if (options.beyondCaller) throw new GrantExceedsCallerPermissionsError(options.beyondCaller);
  });

  return {
    create,
    createPaymentPending,
    assertWithinCaller,
    service: OrganizationInvitationDoorService.create({
      invitations,
      joinRequests: null,
      plans,
      signals,
      lifecycle: { membersInvited: vi.fn(), inviteAccepted: vi.fn() },
      creationThrottle: { assertCreationAllowed: async () => {} },
      ceiling: { assertWithinCaller },
      ensurePersonalWorkspace: vi.fn(async () => undefined),
    }),
  };
}

describe("given an inviter who lacks what the invitation would grant", () => {
  /** @scenario "Inviting someone to a role above the inviter is refused and stores no invitation" */
  it("refuses the batch before storing an invitation", async () => {
    const { service, create, assertWithinCaller } = door({
      beyondCaller: ["organization:manage"],
    });

    await expect(
      service.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "accomplice@acme.test", role: "ADMIN", teams: [] }],
        },
        CALLER,
      ),
    ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
    expect(assertWithinCaller).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      caller: { type: "user", id: CALLER.id },
      grants: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID }],
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given an invitation that names its teams by the legacy team id list", () => {
  /** @scenario "Inviting by legacy team ids is bounded by the inviter's own team access" */
  it("asks the inviter's ceiling for each listed team at the default team role", async () => {
    const { service, create, assertWithinCaller } = door({
      beyondCaller: ["team:view"],
    });

    await expect(
      service.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "accomplice@acme.test", role: "MEMBER", teamIds: "team-1, team-2" }],
        },
        CALLER,
      ),
    ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
    expect(assertWithinCaller).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      caller: { type: "user", id: CALLER.id },
      grants: [
        { role: "MEMBER", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
        { role: "MEMBER", scopeType: "TEAM", scopeId: "team-1" },
        { role: "MEMBER", scopeType: "TEAM", scopeId: "team-2" },
      ],
    });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("given a seat checkout that carries invitations", () => {
  /** @scenario Inviting through a seat checkout is bounded by the inviter */
  it("asks the inviter's ceiling before holding any invitation for payment", async () => {
    const { service, createPaymentPending, assertWithinCaller } = door({
      beyondCaller: ["organization:manage"],
    });

    await expect(
      service.createPaymentPending(
        {
          organizationId: ORGANIZATION_ID,
          subscriptionId: "subscription-1",
          invites: [{ email: "accomplice@acme.test", role: "ADMIN", teamIds: "team-1" }],
        },
        CALLER,
      ),
    ).rejects.toMatchObject({ code: "grant_exceeds_caller_permissions" });
    expect(assertWithinCaller).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      caller: { type: "user", id: CALLER.id },
      grants: [
        { role: "ADMIN", scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
        { role: "ADMIN", scopeType: "TEAM", scopeId: "team-1" },
      ],
    });
    expect(createPaymentPending).not.toHaveBeenCalled();
  });
});
