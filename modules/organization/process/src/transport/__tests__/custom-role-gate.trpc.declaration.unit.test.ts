/**
 * @vitest-environment node
 * Every door that can assign a custom role asks for Enterprise, only then, before the handler.
 * @see specs/features/enterprise-feature-guards.feature
 */
import type { EntitlementGate } from "@langwatch/api/access";
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { groupsRest } from "../group.rest.ts";
import { inviteTrpcTransport } from "../invite.trpc.ts";
import { organizationManagementRest } from "../organization-management.rest.ts";
import { organizationTrpcTransport } from "../organization.trpc.ts";
import { teamTrpcTransport } from "../team.trpc.ts";

const notCalled = (): never => {
  throw new Error("the application is not reached while declaring");
};

/** Each procedure's declared plan question, by its name within the namespace. */
function gates(
  mount: (runtime: TrpcProcedureFactory<object>) => unknown,
): Map<string, EntitlementGate | undefined> {
  const declared = new Map<string, EntitlementGate | undefined>();
  mount({
    procedure: ({ procedure, entitlement }) => {
      declared.set(procedure.split(".")[1] ?? procedure, entitlement);
      return {};
    },
    router: (record) => record,
  });
  return declared;
}

/** Whether the declared gate asks the plan for this input: an absent gate never asks. */
function asks(gate: EntitlementGate | undefined, input: unknown): boolean {
  if (!gate) return false;
  return gate.when ? gate.when(input) : true;
}

const invites = gates((runtime) => inviteTrpcTransport.router(runtime, notCalled));
const organization = gates((runtime) => organizationTrpcTransport.router(runtime, notCalled));
const teams = gates((runtime) => teamTrpcTransport.router(runtime, notCalled));

const invite = (teams: readonly { teamId: string; role: string; customRoleId?: string }[]) => ({
  email: "new@acme.test",
  role: "MEMBER",
  teams,
});

describe("given an organization below Enterprise", () => {
  /**
   * @scenario "Non-enterprise org cannot invite members with custom roles"
   * @scenario "Non-enterprise org cannot create invite requests with custom roles"
   * @scenario "Batch invite rejects entirely when any invite has a custom role"
   */
  it("asks for Enterprise, naming RBAC, before any invitation in a batch naming a custom role", () => {
    const gate = invites.get("createInvites");

    expect(gate).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
    expect(
      asks(gate, {
        organizationId: "org-1",
        invites: [
          invite([{ teamId: "team-1", role: "MEMBER" }]),
          invite([{ teamId: "team-1", role: "custom:role-1", customRoleId: "role-1" }]),
        ],
      }),
    ).toBe(true);
  });

  /** @scenario "Non-enterprise org can invite members with built-in roles" */
  it("invites with built-in team roles without asking the plan", () => {
    expect(
      asks(invites.get("createInvites"), {
        organizationId: "org-1",
        invites: [invite([{ teamId: "team-1", role: "MEMBER" }])],
      }),
    ).toBe(false);
  });

  /** @scenario "Non-enterprise org cannot assign custom roles via member role update" */
  it("asks for Enterprise when a member role change assigns a custom team role", () => {
    const gate = organization.get("updateMemberRole");

    expect(gate).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
    expect(
      asks(gate, {
        organizationId: "org-1",
        userId: "user-2",
        role: "MEMBER",
        teamRoleUpdates: [
          { teamId: "team-1", userId: "user-2", role: "custom:role-1", customRoleId: "role-1" },
        ],
      }),
    ).toBe(true);
    expect(
      asks(gate, {
        organizationId: "org-1",
        userId: "user-2",
        role: "MEMBER",
        teamRoleUpdates: [],
      }),
    ).toBe(false);
  });

  it("asks for Enterprise when one team member's role becomes a custom role", () => {
    const gate = organization.get("updateTeamMemberRole");

    expect(gate).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
    expect(
      asks(gate, { teamId: "team-1", userId: "user-2", role: "custom:role-1", customRoleId: "r" }),
    ).toBe(true);
    expect(asks(gate, { teamId: "team-1", userId: "user-2", role: "VIEWER" })).toBe(false);
  });

  it("asks for Enterprise when a team is created or updated with a custom-role member", () => {
    const members = [{ userId: "user-2", role: "custom:role-1", customRoleId: "role-1" }];
    const builtIn = [{ userId: "user-2", role: "MEMBER" }];

    for (const name of ["update", "createTeamWithMembers"]) {
      const gate = teams.get(name);
      expect(gate).toMatchObject({ entitlement: "enterprise", feature: "RBAC" });
      expect(asks(gate, { teamId: "team-1", organizationId: "org-1", name: "A", members })).toBe(
        true,
      );
      expect(
        asks(gate, { teamId: "team-1", organizationId: "org-1", name: "A", members: builtIn }),
      ).toBe(false);
    }
  });
});

describe("the organization's management REST families", () => {
  /** @scenario The organization and groups families answer 402 below Enterprise, as main */
  it("ask for Enterprise on every route, naming MANAGEMENT_API and GROUPS as main does", () => {
    for (const route of organizationManagementRest.router().routes) {
      expect(route.entitlement).toMatchObject({
        entitlement: "enterprise",
        feature: "MANAGEMENT_API",
      });
    }
    for (const route of groupsRest.router().routes) {
      expect(route.entitlement).toMatchObject({ entitlement: "enterprise", feature: "GROUPS" });
    }
  });
});
