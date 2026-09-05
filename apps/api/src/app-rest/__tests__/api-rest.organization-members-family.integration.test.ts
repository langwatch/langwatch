/**
 * Members and invites over REST: the two self-lockout guards, the last-admin guard that
 * two parallel offboardings race against, the seat limit on re-enabling and on inviting —
 * @see specs/organizations/organization-members-rest-api.feature
 */
import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_BASE,
  ORGANIZATION_BEARER,
  organizationWorld,
} from "./support/organization-family.world";
import { errorCodeOf, TEST_USER_ID } from "./support/rest-family.harness";

/** The credential's own member, plus whoever a scenario adds beside them. */
const acting = {
  userId: TEST_USER_ID,
  name: "Ada Admin",
  email: "ada@acme.test",
  role: "ADMIN" as const,
};

const teamAssignment = { teamId: "team-1", role: "MEMBER" };

describe("given an organization with several members", () => {
  describe("when the members are listed", () => {
    // @scenario "Listing members returns roles and status"
    it("lists active members with role and status, and disabled ones only on request", async () => {
      const world = organizationWorld({
        members: [
          acting,
          { userId: "user-active", name: "Al Active", email: "al@acme.test" },
          { userId: "user-disabled", email: "dis@acme.test", disabled: true },
        ],
      });

      const response = await world.api.get(`${ORGANIZATION_BASE}/members`, ORGANIZATION_BEARER);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { members: Array<{ userId: string }> };
      const ids = body.members.map((member) => member.userId);
      expect(ids).toContain("user-active");
      expect(ids).not.toContain("user-disabled");
      expect(body.members).toContainEqual(
        expect.objectContaining({
          userId: "user-active",
          role: "MEMBER",
          disabled: false,
          user: expect.objectContaining({
            id: "user-active",
            name: "Al Active",
            email: "al@acme.test",
          }),
        }),
      );

      const withDisabled = await world.api.get(
        `${ORGANIZATION_BASE}/members?includeDisabled=true`,
        ORGANIZATION_BEARER,
      );
      const listed = (await withDisabled.json()) as { members: Array<{ userId: string }> };
      expect(listed.members).toContainEqual(
        expect.objectContaining({ userId: "user-disabled", disabled: true }),
      );
    });
  });

  describe("when a member belonging to two teams is fetched", () => {
    // @scenario "Fetching a member includes their team bindings"
    it("lists both teams with the role held on each", async () => {
      const world = organizationWorld({
        members: [
          acting,
          {
            userId: "user-two-teams",
            teams: [
              { teamId: "team-a", teamName: "Team A", role: "MEMBER" },
              { teamId: "team-b", teamName: "Team B", role: "ADMIN" },
            ],
          },
        ],
      });

      const response = await world.api.get(
        `${ORGANIZATION_BASE}/members/user-two-teams`,
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as { teams: Array<Record<string, unknown>> };
      expect(body.teams).toHaveLength(2);
      expect(body.teams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ teamId: "team-a", role: "MEMBER" }),
          expect.objectContaining({ teamId: "team-b", role: "ADMIN" }),
        ]),
      );
    });
  });

  describe("when a member holding the member role is promoted", () => {
    // @scenario "Changing a member's organization role takes effect"
    it("changes the organization role and reads it back", async () => {
      const world = organizationWorld({
        members: [acting, { userId: "user-promote", role: "MEMBER" }],
      });

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/members/user-promote`,
        { role: "ADMIN" },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ role: "ADMIN" });

      const readBack = await world.api.get(
        `${ORGANIZATION_BASE}/members/user-promote`,
        ORGANIZATION_BEARER,
      );
      await expect(readBack.json()).resolves.toMatchObject({ role: "ADMIN" });
    });
  });

  describe("when an active member is disabled", () => {
    // @scenario "Disabling a member blocks their access"
    it("reports them as disabled and drops them from the organization's members", async () => {
      const world = organizationWorld({
        members: [acting, { userId: "user-disable" }],
      });

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/members/user-disable`,
        { disabled: true },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ disabled: true });

      const listed = await world.api.get(`${ORGANIZATION_BASE}/members`, ORGANIZATION_BEARER);
      const body = (await listed.json()) as { members: Array<{ userId: string }> };
      expect(body.members.map((member) => member.userId)).not.toContain("user-disable");
    });
  });

  describe("when a disabled member is re-enabled with no seats left on the plan", () => {
    // @scenario "Re-enabling a member checks the seat limit"
    it("refuses with member_seat_limit_reached and keeps the member disabled", async () => {
      const world = organizationWorld({
        members: [acting, { userId: "user-reenable", disabled: true }],
        seats: 1,
      });

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/members/user-reenable`,
        { disabled: false },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("member_seat_limit_reached");
      expect(world.member("user-reenable")?.disabledAt).not.toBeNull();
    });
  });

  describe("when the credential's own member is disabled", () => {
    // @scenario "A member cannot disable themselves"
    it("refuses with cannot_disable_self and leaves that member active", async () => {
      const world = organizationWorld({ members: [acting] });

      const response = await world.api.patch(
        `${ORGANIZATION_BASE}/members/${TEST_USER_ID}`,
        { disabled: true },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(400);
      await expect(errorCodeOf(response)).resolves.toBe("cannot_disable_self");
      expect(world.member(TEST_USER_ID)?.disabledAt).toBeNull();
    });
  });

  describe("when a member is removed", () => {
    // @scenario "Removing a member deletes the membership"
    it("deletes the membership, after which the member reads as not found", async () => {
      const world = organizationWorld({
        members: [acting, { userId: "user-remove" }],
      });

      const response = await world.api.delete(
        `${ORGANIZATION_BASE}/members/user-remove`,
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ success: true });

      const readBack = await world.api.get(
        `${ORGANIZATION_BASE}/members/user-remove`,
        ORGANIZATION_BEARER,
      );
      expect(readBack.status).toBe(404);
      await expect(errorCodeOf(readBack)).resolves.toBe("member_not_found");
    });
  });

  describe("when the credential's own member is removed", () => {
    // @scenario "A member cannot remove themselves"
    it("refuses with cannot_remove_self and keeps that member in the organization", async () => {
      const world = organizationWorld({
        members: [acting, { userId: "user-other", role: "ADMIN" }],
      });

      const response = await world.api.delete(
        `${ORGANIZATION_BASE}/members/${TEST_USER_ID}`,
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(400);
      await expect(errorCodeOf(response)).resolves.toBe("cannot_remove_self");
      expect(world.member(TEST_USER_ID)).toBeDefined();
    });
  });

  describe("when the organization's one active admin is removed", () => {
    // @scenario "Removing the last active admin is refused"
    it("refuses with cannot_remove_last_admin and keeps somebody who can sign in", async () => {
      // A service credential acts as nobody, so the self guard cannot be what
      // refuses here — only the last-admin guard can.
      const world = organizationWorld({
        actingUserId: null,
        members: [{ userId: "user-sole-admin", role: "ADMIN" }, { userId: "user-plain" }],
      });

      const response = await world.api.delete(
        `${ORGANIZATION_BASE}/members/user-sole-admin`,
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(400);
      await expect(errorCodeOf(response)).resolves.toBe("cannot_remove_last_admin");
      expect(world.member("user-sole-admin")).toBeDefined();
    });
  });

  describe("when two offboardings remove both admins at the same time", () => {
    // @scenario "Two admins removed at the same time cannot both succeed"
    it("refuses one of them and leaves the organization with an active admin", async () => {
      const world = organizationWorld({
        actingUserId: null,
        members: [
          { userId: "user-admin-a", role: "ADMIN" },
          { userId: "user-admin-b", role: "ADMIN" },
        ],
      });

      const [first, second] = await Promise.all([
        world.api.delete(`${ORGANIZATION_BASE}/members/user-admin-a`, ORGANIZATION_BEARER),
        world.api.delete(`${ORGANIZATION_BASE}/members/user-admin-b`, ORGANIZATION_BEARER),
      ]);

      const statuses = [first.status, second.status].sort();
      expect(statuses).toEqual([200, 400]);
      const refused = first.status === 400 ? first : second;
      await expect(errorCodeOf(refused)).resolves.toBe("cannot_remove_last_admin");
      expect(
        [world.member("user-admin-a"), world.member("user-admin-b")].filter(Boolean),
      ).toHaveLength(1);
    });
  });

  describe("when a member's access breakdown is fetched", () => {
    // @scenario "A member's access breakdown spans teams and projects"
    it("reports the organization, team and project access with the scope each comes from", async () => {
      const world = organizationWorld({
        members: [
          acting,
          {
            userId: "user-breakdown",
            teams: [{ teamId: "team-a", teamName: "Team A", role: "MEMBER" }],
          },
        ],
      });

      const response = await world.api.get(
        `${ORGANIZATION_BASE}/members/user-breakdown/access`,
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        user: { id: string; orgRole: string; orgRolePermissions: string[] };
        directBindings: Array<{ scopeType: string; scopeId: string; permissions: string[] }>;
      };
      expect(body.user).toMatchObject({ id: "user-breakdown", orgRole: "MEMBER" });
      expect(body.user.orgRolePermissions).toContain("organization:view");
      expect(body.directBindings.map((binding) => binding.scopeType)).toEqual(
        expect.arrayContaining(["ORGANIZATION", "TEAM", "PROJECT"]),
      );
      for (const binding of body.directBindings) {
        expect(binding.scopeId).toBeTruthy();
        expect(Array.isArray(binding.permissions)).toBe(true);
      }
      expect(body.directBindings).toContainEqual(
        expect.objectContaining({ scopeType: "TEAM", scopeId: "team-a", scopeName: "Team A" }),
      );
    });
  });
});

describe("given invites managed over REST", () => {
  describe("when the organization has a pending invite and they are listed", () => {
    // @scenario "Listing invites includes the invite link"
    it("carries the email, role, invite code and invite link", async () => {
      const world = organizationWorld({
        members: [acting],
        invites: [{ id: "invite-1", email: "newcomer@acme.test", role: "MEMBER" }],
      });

      const response = await world.api.get(`${ORGANIZATION_BASE}/invites`, ORGANIZATION_BEARER);

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        invites: Array<{ email: string; role: string; inviteCode: string; inviteUrl: string }>;
      };
      const invite = body.invites.find((entry) => entry.email === "newcomer@acme.test");
      expect(invite).toBeDefined();
      expect(invite?.role).toBe("MEMBER");
      expect(invite?.inviteCode).toBeTruthy();
      expect(invite?.inviteUrl).toContain(invite!.inviteCode);
    });
  });

  describe("when two people are invited onto a team carrying a custom role", () => {
    // @scenario "Creating invites assigns teams including a custom role"
    it("creates both with that team assignment and reports email delivery", async () => {
      const world = organizationWorld({ members: [acting] });
      const emails = ["custom-1@acme.test", "custom-2@acme.test"];

      const response = await world.api.post(
        `${ORGANIZATION_BASE}/invites`,
        {
          invites: emails.map((email) => ({
            email,
            role: "MEMBER",
            teams: [{ teamId: "team-a", role: "CUSTOM", customRoleId: "customrole-1" }],
          })),
        },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        invites: Array<{ email: string; teams: unknown[]; emailNotSent: boolean }>;
      };
      expect(body.invites).toHaveLength(2);
      for (const invite of body.invites) {
        expect(emails).toContain(invite.email);
        expect(invite.teams).toEqual([
          expect.objectContaining({
            teamId: "team-a",
            role: "CUSTOM",
            customRoleId: "customrole-1",
          }),
        ]);
        expect(invite.emailNotSent).toBe(false);
      }
    });
  });

  describe("when the address invited already belongs to a member", () => {
    // @scenario "Inviting an existing member is refused"
    it("refuses with already_organization_member and creates no invite", async () => {
      const world = organizationWorld({ members: [acting] });

      const response = await world.api.post(
        `${ORGANIZATION_BASE}/invites`,
        { invites: [{ email: acting.email, role: "MEMBER", teams: [teamAssignment] }] },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(409);
      await expect(errorCodeOf(response)).resolves.toBe("already_organization_member");
      expect(world.invites()).toHaveLength(0);
    });
  });

  describe("when an address with a pending invite is invited again", () => {
    // @scenario "A duplicate pending invite is refused"
    it("refuses with duplicate_invite and leaves one invite for that address", async () => {
      const world = organizationWorld({
        members: [acting],
        invites: [{ id: "invite-1", email: "dup@acme.test" }],
      });

      const response = await world.api.post(
        `${ORGANIZATION_BASE}/invites`,
        { invites: [{ email: "dup@acme.test", role: "MEMBER", teams: [teamAssignment] }] },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(409);
      await expect(errorCodeOf(response)).resolves.toBe("duplicate_invite");
      expect(world.invites().filter((invite) => invite.email === "dup@acme.test")).toHaveLength(1);
    });
  });

  describe("when three people are invited onto a plan with one seat left", () => {
    // @scenario "Invites beyond the seat limit are refused"
    it("refuses with member_seat_limit_reached and creates none of the batch", async () => {
      const world = organizationWorld({ members: [acting], seats: 2 });

      const response = await world.api.post(
        `${ORGANIZATION_BASE}/invites`,
        {
          invites: ["over-1@acme.test", "over-2@acme.test", "over-3@acme.test"].map((email) => ({
            email,
            role: "MEMBER",
            teams: [teamAssignment],
          })),
        },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("member_seat_limit_reached");
      expect(world.invites()).toHaveLength(0);
    });
  });

  describe("when the team assignment names somebody's personal workspace", () => {
    // @scenario "An invite cannot assign a personal workspace team"
    it("refuses with personal_workspace_not_managed_here and creates no invite", async () => {
      const world = organizationWorld({ members: [acting], personalTeamIds: ["team-personal"] });

      const response = await world.api.post(
        `${ORGANIZATION_BASE}/invites`,
        {
          invites: [
            {
              email: "outsider@acme.test",
              role: "MEMBER",
              teams: [{ teamId: "team-personal", role: "MEMBER" }],
            },
          ],
        },
        ORGANIZATION_BEARER,
      );

      expect(response.status).toBe(403);
      await expect(errorCodeOf(response)).resolves.toBe("personal_workspace_not_managed_here");
      expect(world.invites()).toHaveLength(0);
    });
  });

  describe("when a pending invite is revoked", () => {
    // @scenario "Revoking a pending invite marks it REVOKED"
    it("keeps it listed as REVOKED and refuses a second revoke with invite_not_found", async () => {
      const world = organizationWorld({
        members: [acting],
        invites: [{ id: "invite-1", email: "revoke@acme.test" }],
      });

      const revoke = await world.api.delete(
        `${ORGANIZATION_BASE}/invites/invite-1`,
        ORGANIZATION_BEARER,
      );

      expect(revoke.status).toBe(200);
      const list = await world.api.get(`${ORGANIZATION_BASE}/invites`, ORGANIZATION_BEARER);
      const body = (await list.json()) as { invites: Array<{ id: string; status: string }> };
      expect(body.invites).toContainEqual(
        expect.objectContaining({ id: "invite-1", status: "REVOKED" }),
      );

      const again = await world.api.delete(
        `${ORGANIZATION_BASE}/invites/invite-1`,
        ORGANIZATION_BEARER,
      );
      expect(again.status).toBe(404);
      await expect(errorCodeOf(again)).resolves.toBe("invite_not_found");
    });
  });
});

describe("given the members family addressed without the /v1 prefix", () => {
  describe("when the members are listed through both paths", () => {
    it("answers the un-prefixed path identically to the /v1 one", async () => {
      const world = organizationWorld({ members: [acting] });

      const prefixed = await world.api.get(
        "/api/v1/organization/latest/members",
        ORGANIZATION_BEARER,
      );
      const plain = await world.api.get("/api/organization/latest/members", ORGANIZATION_BEARER);

      expect(plain.status).toBe(prefixed.status);
      await expect(plain.json()).resolves.toEqual(await prefixed.json());
    });
  });
});
