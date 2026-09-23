import { createApiFixture } from "@langwatch/api-fixture";
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

function door(options: { customRolesAllowed: boolean }) {
  const create = vi.fn(async () => ({
    organization: { id: ORGANIZATION_ID, members: [] },
    invites: [],
  }));
  const assertCustomRolesAllowed = vi.fn(async () => {
    if (!options.customRolesAllowed) throw new CustomRolesUnavailableError();
  });

  const invitations = createApiFixture<OrganizationInvitations>({ create });
  const plans = createApiFixture<OrganizationPlanGate>({ assertCustomRolesAllowed });
  const signals = createApiFixture<OrganizationSignals>({
    trackServerEvent: vi.fn(),
    fireTeamMemberInvitedNurturing: vi.fn(),
  });

  return {
    create,
    assertCustomRolesAllowed,
    service: OrganizationInvitationDoorService.create({
      invitations,
      joinRequests: null,
      plans,
      signals,
      creationThrottle: { assertCreationAllowed: async () => {} },
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
