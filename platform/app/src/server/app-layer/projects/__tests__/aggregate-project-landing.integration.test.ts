/**
 * @vitest-environment node
 *
 * ADR-144 block F: an aggregate is never the project the app lands on. An
 * admin opens it on purpose from the project switcher; when the app picks a
 * project because none was chosen, it skips every aggregate, even one older
 * than everything else the admin can open.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { selectAmbientTeam } from "~/hooks/useOrganizationTeamProject";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { landingProjectOf } from "../project-kinds";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

describe("Feature: an aggregate is never the default landing project", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;
  let admin: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-land" });
    // Older than every other project on the team, so a plain "first by
    // creation" pick would land on it.
    aggregate = await prisma.project.update({
      where: { id: (await fixture.makeAggregate("company-view")).id },
      data: { createdAt: new Date("2000-01-01T00:00:00Z") },
    });
    admin = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: fixture.admin.id }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  describe("given ana belongs to an aggregate project and an ordinary project", () => {
    describe("when the app picks a project for ana because none was chosen", () => {
      /** @scenario "An aggregate is never the project the app lands on" */
      it("picks the ordinary project for the home page", async () => {
        const state = await admin.user.homePagePickerState({
          organizationId: fixture.organizationId,
        });

        expect(state.firstProjectSlug).toBe(fixture.shared.slug);
        expect(state.firstProjectSlug).not.toBe(aggregate.slug);
      });

      /** @scenario "An aggregate is never the project the app lands on" */
      it("picks the ordinary project as the ambient one", async () => {
        const organizations = await admin.organization.getAll({});
        const organization = organizations.find(
          (candidate) => candidate.id === fixture.organizationId,
        );
        const team = selectAmbientTeam({
          teams: organization?.teams ?? [],
          userId: fixture.admin.id,
        });
        const sharedTeamProjects = team?.projects ?? [];

        // The aggregate is on the same team, and whatever order the team
        // lists its projects in, it is skipped.
        expect(sharedTeamProjects.map((project) => project.id)).toContain(
          aggregate.id,
        );
        expect(landingProjectOf(sharedTeamProjects)?.id).toBe(
          fixture.shared.id,
        );
        expect(landingProjectOf([...sharedTeamProjects].reverse())?.id).toBe(
          fixture.shared.id,
        );
      });
    });
  });
});
