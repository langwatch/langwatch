import { createApiFixture } from "@langwatch/api-fixture";
import { GrantExceedsCallerPermissionsError } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
/**
 * @vitest-environment node
 *
 * Custom team roles gate invitations before writing: all-or-nothing on batch.
 * @see specs/features/enterprise-feature-guards.feature
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

/** The refusal the plan gate raises on a deployment without the capability. */
class CustomRolesUnavailableError extends HandledError {
  constructor() {
    super("permission_denied", "Custom roles require an Enterprise plan", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "CustomRolesUnavailableError";
  }
}

function door(options: { customRolesAllowed: boolean; beyondCaller?: string[] }) {
  const create = vi.fn(async () => ({
    organization: { id: ORGANIZATION_ID, members: [] },
    invites: [],
  }));
  const assertCustomRolesAllowed = vi.fn(async () => {
    if (!options.customRolesAllowed) throw new CustomRolesUnavailableError();
  });

  const createPaymentPending = vi.fn(async () => undefined);
  const invitations = createApiFixture<OrganizationInvitations>({ create, createPaymentPending });
  const plans = createApiFixture<OrganizationPlanGate>({ assertCustomRolesAllowed });
  const signals = createApiFixture<OrganizationSignals>({ trackServerEvent: vi.fn() });

  const assertWithinCaller = vi.fn(async () => {
    if (options.beyondCaller) throw new GrantExceedsCallerPermissionsError(options.beyondCaller);
  });

  return {
    create,
    createPaymentPending,
    assertWithinCaller,
    assertCustomRolesAllowed,
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

describe("given an invitation batch that names a custom team role", () => {
  describe("when the plan carries custom roles", () => {
    it("asks the plan before writing anything", async () => {
      const { service, assertCustomRolesAllowed, create } = door({ customRolesAllowed: true });

      await service.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [
            {
              email: "new@acme.test",
              role: "MEMBER",
              teams: [{ teamId: "team-1", role: "custom:role-1", customRoleId: "role-1" }],
            },
          ],
        },
        CALLER,
      );

      expect(assertCustomRolesAllowed).toHaveBeenCalledWith({ organizationId: ORGANIZATION_ID });
      expect(create).toHaveBeenCalled();
    });
  });

  describe("when the plan does not carry custom roles", () => {
    /**
     * The refusal is raised before the write, so a batch that mixes one
     * custom-role invitation in with built-in ones creates none of them.
     *
     * @scenario "Non-enterprise org cannot invite members with custom roles"
     * @scenario "Batch invite rejects entirely when any invite has a custom role"
     * @scenario "Non-enterprise org cannot create invite requests with custom roles"
     */
    it("refuses the whole batch and writes none of it", async () => {
      const { service, create } = door({ customRolesAllowed: false });

      await expect(
        service.create(
          {
            organizationId: ORGANIZATION_ID,
            validation: "lenient",
            invites: [
              {
                email: "builtin@acme.test",
                role: "MEMBER",
                teams: [{ teamId: "team-1", role: "MEMBER" }],
              },
              {
                email: "custom@acme.test",
                role: "MEMBER",
                teams: [{ teamId: "team-1", role: "custom:role-1", customRoleId: "role-1" }],
              },
            ],
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "permission_denied" });

      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("given every invitation in the batch names a built-in team role", () => {
  describe("when the batch is created", () => {
    /** @scenario "Non-enterprise org can invite members with built-in roles" */
    it("creates them without consulting the plan", async () => {
      const { service, assertCustomRolesAllowed, create } = door({ customRolesAllowed: false });

      await service.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [
            {
              email: "new@acme.test",
              role: "MEMBER",
              teams: [{ teamId: "team-1", role: "MEMBER" }],
            },
          ],
        },
        CALLER,
      );

      expect(assertCustomRolesAllowed).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalled();
    });
  });
});

describe("given an inviter who lacks what the invitation would grant", () => {
  /** @scenario "Inviting someone to a role above the inviter is refused and stores no invitation" */
  it("refuses the batch before storing an invitation", async () => {
    const { service, create, assertWithinCaller } = door({
      customRolesAllowed: true,
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
      customRolesAllowed: true,
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
      customRolesAllowed: true,
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
