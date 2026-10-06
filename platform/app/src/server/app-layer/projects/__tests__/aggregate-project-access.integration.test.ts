/**
 * @vitest-environment node
 *
 * ADR-144 decision 5: only an organisation admin opens an aggregate project.
 * The aggregate sits on a team like any project, and everyone in this suite
 * holds an ADMIN binding on that team, so whatever refuses them is the
 * admin-only rule and not a missing grant.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveLwqlQueryScope } from "~/app/api/query/[[...route]]/queryScope";
import type { Project } from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import {
  batchProjectPermissions,
  batchScopePermissions,
} from "~/server/app-layer/authz/permission-adapters";
import { resolveApiKeyPermissionProjectBatch } from "~/server/app-layer/authz/credential-permissions";
import { permissionsServiceFor } from "~/server/app-layer/permissions/runtime";
import { createTestApp } from "~/server/app-layer/presets";
import { getDataPrivacySnapshot } from "~/server/data-privacy/dataPrivacyPolicy.read";
import { prisma } from "~/server/db";
import { resolveCallerProjectScope } from "~/server/organizations/resolveCallerProjectScope";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

const sessionOf = (userId: string) => ({
  prisma,
  session: { user: { id: userId }, expires: "1" },
});

const listedProjectIds = async (userId: string, organizationId: string) => {
  const organizations = await callerFor(userId).organization.getAll({});
  return organizations
    .filter((organization) => organization.id === organizationId)
    .flatMap((organization) => organization.teams)
    .flatMap((team) => team.projects.map((project) => project.id));
};

describe("Feature: only organisation admins open an aggregate project", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-access" });
    aggregate = await fixture.makeAggregate("company-view");
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  /** @scenario "A non-admin on the aggregate's team is refused" */
  describe("given an aggregate project whose team includes a member who is not an admin", () => {
    describe("when the member opens the aggregate project", () => {
      it("is refused, though the same member opens an ordinary project on that team", async () => {
        const member = callerFor(fixture.member.id);

        await expect(
          member.project.getHasFirstMessage({ projectId: fixture.shared.id }),
        ).resolves.toEqual({ firstMessage: false });
        const refusal = await member.project
          .getHasFirstMessage({ projectId: aggregate.id })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(TRPCError);
        expect((refusal as TRPCError).code).toMatch(/FORBIDDEN|UNAUTHORIZED/);
      });

      it("is refused on a route that reads through a different permission", async () => {
        await expect(
          callerFor(fixture.member.id).project.getFieldRedactionStatus({
            projectId: aggregate.id,
          }),
        ).rejects.toBeInstanceOf(TRPCError);
      });
    });

    describe("when an organisation admin opens it", () => {
      it("is let in", async () => {
        await expect(
          callerFor(fixture.admin.id).project.getHasFirstMessage({
            projectId: aggregate.id,
          }),
        ).resolves.toEqual({ firstMessage: false });
      });
    });

    describe("when the member lists the projects they can open", () => {
      it("does not list the aggregate", async () => {
        const ids = await listedProjectIds(
          fixture.member.id,
          fixture.organizationId,
        );

        expect(ids).toContain(fixture.shared.id);
        expect(ids).not.toContain(aggregate.id);
      });
    });
  });

  describe("given a batched permission check that covers the aggregate", () => {
    const scopeBatch = async (userId: string, permission: "project:view" | "project:update") => {
      const { projects } = await batchScopePermissions(sessionOf(userId), {
        organizationId: fixture.organizationId,
        teamIds: [],
        projectIds: [aggregate.id, fixture.shared.id],
        projectTeamId: {
          [aggregate.id]: fixture.team.id,
          [fixture.shared.id]: fixture.team.id,
        },
        permission,
      });
      return {
        aggregate: projects.get(aggregate.id),
        shared: projects.get(fixture.shared.id),
      };
    };

    describe("when the caller is a member who is not an admin", () => {
      it("answers false for the aggregate and true for the ordinary project", async () => {
        for (const permission of ["project:view", "project:update"] as const) {
          expect(await scopeBatch(fixture.member.id, permission)).toEqual({
            aggregate: false,
            shared: true,
          });
        }
      });

      it("holds nothing on the aggregate through the single-project batch", async () => {
        const held = (projectId: string) =>
          batchProjectPermissions(sessionOf(fixture.member.id), {
            organizationId: fixture.organizationId,
            projectId,
            teamId: fixture.team.id,
            permissions: ["project:view", "traces:view"],
          });

        expect(await held(aggregate.id)).toEqual([]);
        expect(await held(fixture.shared.id)).toEqual([
          "project:view",
          "traces:view",
        ]);
      });
    });

    describe("when a member who is not an admin opens the data privacy scope picker", () => {
      it("offers the ordinary project and not the aggregate, which an admin is offered", async () => {
        const offered = async (userId: string) =>
          (
            await getDataPrivacySnapshot(sessionOf(userId), {
              projectId: fixture.shared.id,
            })
          ).available.projects.map((project) => project.id);

        const toMember = await offered(fixture.member.id);
        expect(toMember).toContain(fixture.shared.id);
        expect(toMember).not.toContain(aggregate.id);
        expect(await offered(fixture.admin.id)).toContain(aggregate.id);
      });
    });

    describe("when a member who is not an admin asks what they may do on the aggregate", () => {
      it("is told nothing, while the ordinary project and an admin keep their permissions", async () => {
        const effective = async (userId: string, projectId: string) =>
          (await callerFor(userId).authz.effectivePermissions({ projectId }))
            .permissions;

        expect(await effective(fixture.member.id, aggregate.id)).toEqual([]);
        expect(await effective(fixture.member.id, fixture.shared.id)).toContain(
          "project:view",
        );
        expect(await effective(fixture.admin.id, aggregate.id)).toContain(
          "project:view",
        );
      });
    });

    describe("when the caller is an organisation admin", () => {
      it("answers true for the aggregate", async () => {
        for (const permission of ["project:view", "project:update"] as const) {
          expect(await scopeBatch(fixture.admin.id, permission)).toEqual({
            aggregate: true,
            shared: true,
          });
        }
      });
    });

    describe("when the caller is an API key", () => {
      const keyBatch = async (ownerUserId: string | null) => {
        const key = await fixture.makeApiKey({ ownerUserId });
        const decisions = await resolveApiKeyPermissionProjectBatch({
          prisma,
          apiKeyId: key.id,
          userId: ownerUserId,
          organizationId: fixture.organizationId,
          projects: [
            { projectId: aggregate.id, teamId: fixture.team.id },
            { projectId: fixture.shared.id, teamId: fixture.team.id },
          ],
          permissions: ["project:view"],
        });
        const projects = decisions.get("project:view");
        return {
          aggregate: projects?.get(aggregate.id),
          shared: projects?.get(fixture.shared.id),
        };
      };

      it("refuses the aggregate to a key whose owner is not an admin", async () => {
        expect(await keyBatch(fixture.member.id)).toEqual({
          aggregate: false,
          shared: true,
        });
      });

      it("refuses the aggregate to a service key with no owner", async () => {
        expect((await keyBatch(null)).aggregate).toBe(false);
      });

      it("admits the aggregate to a key whose owner is an organisation admin", async () => {
        expect(await keyBatch(fixture.admin.id)).toEqual({
          aggregate: true,
          shared: true,
        });
      });
    });
  });

  describe("given an API key reading across its organisation", () => {
    const permissions = () => permissionsServiceFor(prisma);

    const lwqlReadable = async (ownerUserId: string | null) => {
      const key = await fixture.makeApiKey({ ownerUserId });
      const { projects } = await resolveLwqlQueryScope({
        principal: {
          kind: "apiKey",
          apiKeyId: key.id,
          userId: ownerUserId,
          organizationId: fixture.organizationId,
        },
        permissions: permissions(),
        prisma,
        protectionsFor: async () => ({}),
      });
      return projects.map((project) => project.id);
    };

    const callerScope = async (ownerUserId: string | null) => {
      const key = await fixture.makeApiKey({ ownerUserId });
      const { permittedProjectIds } = await resolveCallerProjectScope({
        userId: ownerUserId,
        organizationId: fixture.organizationId,
        prisma,
        apiKeyCeiling: {
          apiKeyId: key.id,
          cuts: (query) => permissions().apiKeyProjectCuts(query),
        },
      });
      return permittedProjectIds;
    };

    describe("when LangWatchQL resolves the projects the key may read", () => {
      it("leaves the aggregate out for a non-admin owner and a service key, and keeps it for an admin owner", async () => {
        const toMember = await lwqlReadable(fixture.member.id);
        expect(toMember).toContain(fixture.shared.id);
        expect(toMember).not.toContain(aggregate.id);
        expect(await lwqlReadable(null)).not.toContain(aggregate.id);
        expect(await lwqlReadable(fixture.admin.id)).toContain(aggregate.id);
      });
    });

    describe("when the caller's project scope is resolved", () => {
      it("leaves the aggregate out for a non-admin owner and a service key, and keeps it for an admin owner", async () => {
        const toMember = await callerScope(fixture.member.id);
        expect(toMember).toContain(fixture.shared.id);
        expect(toMember).not.toContain(aggregate.id);
        expect(await callerScope(null)).not.toContain(aggregate.id);
        expect(await callerScope(fixture.admin.id)).toContain(aggregate.id);
      });
    });
  });

  /** @scenario "A Developer seat never sees the aggregate project" */
  describe("given a member holding only a Developer seat, put on the aggregate's team", () => {
    describe("when they list the projects they can open", () => {
      it("does not list the aggregate", async () => {
        const ids = await listedProjectIds(
          fixture.developer.id,
          fixture.organizationId,
        );

        expect(ids).not.toContain(aggregate.id);
      });

      it("is refused when it opens the aggregate by id", async () => {
        await expect(
          callerFor(fixture.developer.id).project.getHasFirstMessage({
            projectId: aggregate.id,
          }),
        ).rejects.toBeInstanceOf(TRPCError);
      });
    });

    describe("when an organisation admin lists the same organisation", () => {
      it("lists the aggregate", async () => {
        expect(
          await listedProjectIds(fixture.admin.id, fixture.organizationId),
        ).toContain(aggregate.id);
      });
    });
  });
});
