/**
 * @vitest-environment node
 *
 * The `team.*` tRPC surface: the eight procedure names the clients call, the
 * `callerCanManage` probe the two member reads pass to the service so it can
 * decide how much of each member row to return, the team lookup that supplies
 * the organization the write acts in, and the Enterprise plan gate that
 * refuses a custom team role.
 *
 * The procedure handed in narrows its own context the way an authenticated
 * process procedure does, so this also pins that a process can hand over a
 * procedure it has already composed.
 */
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  OrganizationApp,
  type OrganizationAppDependencies,
} from "../organization.app";
import { TeamTrpcApi } from "../../transport/api-trpc/team.api";

type TestContext = {
  app: { organizations: OrganizationApp };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

/** The feature's application over two stub services, as the process builds it. */
function application(
  organizations: Partial<OrganizationService>,
  projects: Partial<ProjectService>,
): OrganizationApp {
  return OrganizationApp.create({
    organizations: organizations as unknown as OrganizationAppDependencies["organizations"],
    projects: projects as unknown as OrganizationAppDependencies["projects"],
  });
}

function harness({
  organizations = {},
  projects = {},
  callerCanManage = true,
  assertCustomRolesAllowed = async () => {},
}: {
  organizations?: Partial<OrganizationService>;
  projects?: Partial<ProjectService>;
  callerCanManage?: boolean;
  assertCustomRolesAllowed?: () => Promise<void>;
} = {}) {
  const probeOrganizationPermission = vi.fn(async () => callerCanManage);
  const assertCustomRoles = vi.fn(assertCustomRolesAllowed);

  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const router = TeamTrpcApi.create(
    trpc,
    { protected: authenticated, policy: () => (procedure) => procedure },
    {
      probeOrganizationPermission,
      assertCustomRolesAllowed: assertCustomRoles,
    },
  );

  return {
    router,
    probeOrganizationPermission,
    assertCustomRolesAllowed: assertCustomRoles,
    caller: router.createCaller({
      app: { organizations: application(organizations, projects) },
      actor: () => ({ id: "test-user-id" }),
      session: { user: { id: "test-user-id" } },
    }),
  };
}

const TEAM = {
  id: "team-1",
  organizationId: "org-1",
  name: "Engineering",
  slug: "engineering",
};

/** The stub team, as the service's own return type. */
const team = TEAM as never;

describe("TeamTrpcApi", () => {
  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware at the point `.input()`
     * is called, so anything installed before it runs with `input ===
     * undefined`. The process's real policy resolves the authorized scope id
     * FROM the input, which is why this feature applies the decorator after
     * its own parser. Installed the other way round, the authorization check,
     * the scope-lineage guard and the audit row would all see nothing and
     * every guard would still report green.
     */
    it("hands the policy the parsed input, not undefined", async () => {
      const seen: unknown[] = [];
      const trpc = initTRPC.context<TestContext>().create();
      const router = TeamTrpcApi.create(
        trpc,
        {
          protected: trpc.procedure,
          policy:
            () =>
            <TProcedure>(procedure: TProcedure): TProcedure =>
              (procedure as { use(fn: unknown): unknown }).use(
                ({ input, next }: { input: unknown; next: () => unknown }) => {
                  seen.push(input);
                  return next();
                },
              ) as TProcedure,
        },
        {
          probeOrganizationPermission: async () => true,
          assertCustomRolesAllowed: async () => {},
        },
      );

      await router
        .createCaller({
          app: {
            organizations: application({ getTeamBySlugForMember: async () => team }, {}),
          },
          actor: () => ({ id: "test-user-id" }),
          session: { user: { id: "test-user-id" } },
        })
        .getBySlug({ organizationId: "org-1", slug: "engineering" });

      expect(seen).toEqual([{ organizationId: "org-1", slug: "engineering" }]);
    });
  });

  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "archiveById",
        "createTeamWithMembers",
        "getBySlug",
        "getTeamWithMembers",
        "getTeamsWithMembers",
        "getTeamsWithRoleBindings",
        "removeMember",
        "update",
      ]);
    });
  });

  describe("when a team is read by slug", () => {
    it("resolves it for the caller as a member, never for anyone else", async () => {
      const getTeamBySlugForMember = vi.fn(async () => team);
      const { caller } = harness({ organizations: { getTeamBySlugForMember } });

      await caller.getBySlug({ organizationId: "org-1", slug: "engineering" });

      expect(getTeamBySlugForMember).toHaveBeenCalledWith({
        organizationId: "org-1",
        slug: "engineering",
        userId: "test-user-id",
      });
    });
  });

  describe("when the organization's teams are listed", () => {
    it("tells the service whether the caller may manage, and files each project under its team", async () => {
      const listTeamsWithMembers = vi.fn(async () => [
        { ...TEAM, id: "team-1" } as never,
        { ...TEAM, id: "team-2" } as never,
      ]);
      const { caller, probeOrganizationPermission } = harness({
        callerCanManage: false,
        organizations: { listTeamsWithMembers },
        projects: {
          listByOrganization: async () =>
            ({
              data: [
                { id: "p1", name: "One", teamId: "team-1" },
                { id: "p2", name: "Two", teamId: "team-2" },
              ],
            }) as never,
        },
      });

      const teams = await caller.getTeamsWithMembers({ organizationId: "org-1" });

      expect(probeOrganizationPermission).toHaveBeenCalledWith(
        expect.anything(),
        "org-1",
        "organization:manage",
      );
      expect(listTeamsWithMembers).toHaveBeenCalledWith({
        organizationId: "org-1",
        callerUserId: "test-user-id",
        callerCanManage: false,
      });
      expect(teams.map(({ id, projects }) => [id, projects.map((p) => p.id)])).toEqual([
        ["team-1", ["p1"]],
        ["team-2", ["p2"]],
      ]);
    });
  });

  describe("when the access matrix is read", () => {
    it("hands the service only the project identity it needs to place each binding", async () => {
      const listTeamAccess = vi.fn(async () => []);
      const { caller } = harness({
        organizations: { listTeamAccess },
        projects: {
          listByOrganization: async () =>
            ({
              data: [{ id: "p1", name: "One", teamId: "team-1", slug: "one", language: "python" }],
            }) as never,
        },
      });

      await caller.getTeamsWithRoleBindings({ organizationId: "org-1" });

      expect(listTeamAccess).toHaveBeenCalledWith({
        organizationId: "org-1",
        projects: [{ id: "p1", name: "One", teamId: "team-1" }],
      });
    });
  });

  describe("when one team is opened", () => {
    it("returns its members alongside the projects that live in it", async () => {
      const { caller } = harness({
        organizations: {
          getTeamWithMembers: async () => ({ ...TEAM, members: [] }) as never,
        },
        projects: { listByTeam: async () => [{ id: "p1" }] as never },
      });

      const team = await caller.getTeamWithMembers({
        organizationId: "org-1",
        slug: "engineering",
      });

      expect(team).toMatchObject({ id: "team-1", projects: [{ id: "p1" }] });
    });
  });

  describe("when the team settings form is saved", () => {
    it("resolves the team's organization before it writes, and attributes the change to the caller", async () => {
      const updateTeamWithMembers = vi.fn(async () => {});
      const { caller, assertCustomRolesAllowed } = harness({
        organizations: { getTeamById: async () => team, updateTeamWithMembers },
      });

      await expect(
        caller.update({
          teamId: "team-1",
          name: "Engineering",
          members: [{ userId: "u1", role: "ADMIN" }],
        }),
      ).resolves.toEqual({ success: true });

      expect(assertCustomRolesAllowed).toHaveBeenCalledWith(expect.anything(), {
        organizationId: "org-1",
        members: [{ userId: "u1", role: "ADMIN" }],
      });
      expect(updateTeamWithMembers).toHaveBeenCalledWith({
        teamId: "team-1",
        name: "Engineering",
        members: [{ userId: "u1", role: "ADMIN" }],
        actor: { type: "user", id: "test-user-id" },
      });
    });

    it("refuses a custom role the organization's plan does not include, before any write", async () => {
      const updateTeamWithMembers = vi.fn(async () => {});
      const { caller } = harness({
        organizations: { getTeamById: async () => team, updateTeamWithMembers },
        assertCustomRolesAllowed: async () => {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Custom roles require an Enterprise plan",
          });
        },
      });

      await expect(
        caller.update({
          teamId: "team-1",
          name: "Engineering",
          members: [{ userId: "u1", role: "custom:auditor", customRoleId: "role-1" }],
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(updateTeamWithMembers).not.toHaveBeenCalled();
    });
  });

  describe("when a team is created", () => {
    it("checks the plan against the organization named in the request", async () => {
      const createTeamWithMembers = vi.fn(async () => team);
      const { caller, assertCustomRolesAllowed } = harness({
        organizations: { createTeamWithMembers },
      });

      await caller.createTeamWithMembers({
        organizationId: "org-1",
        name: "Engineering",
        members: [{ userId: "u1", role: "ADMIN" }],
      });

      expect(assertCustomRolesAllowed).toHaveBeenCalledWith(expect.anything(), {
        organizationId: "org-1",
        members: [{ userId: "u1", role: "ADMIN" }],
      });
      expect(createTeamWithMembers).toHaveBeenCalledWith({
        organizationId: "org-1",
        name: "Engineering",
        members: [{ userId: "u1", role: "ADMIN" }],
        actor: { type: "user", id: "test-user-id" },
      });
    });
  });

  describe("when a team is archived", () => {
    it("archives it in the organization the team itself names, not one the caller supplied", async () => {
      const archiveTeam = vi.fn(async () => team);
      const { caller } = harness({
        organizations: { getTeamById: async () => team, archiveTeam },
      });

      await expect(caller.archiveById({ teamId: "team-1" })).resolves.toEqual({
        success: true,
      });
      expect(archiveTeam).toHaveBeenCalledWith({
        teamId: "team-1",
        organizationId: "org-1",
      });
    });
  });

  describe("when a member is removed", () => {
    it("names the removed user back so the screen can settle without a refetch", async () => {
      const removeTeamMember = vi.fn(async () => {});
      const { caller } = harness({
        organizations: { getTeamById: async () => team, removeTeamMember },
      });

      await expect(caller.removeMember({ teamId: "team-1", userId: "u1" })).resolves.toEqual({
        success: true,
        removedUserId: "u1",
      });
      expect(removeTeamMember).toHaveBeenCalledWith({
        teamId: "team-1",
        userId: "u1",
        organizationId: "org-1",
        actor: { type: "user", id: "test-user-id" },
      });
    });
  });
});
