/**
 * @vitest-environment node
 *
 * ADR-144: the projects the new project drawer offers an organisation admin
 * for an aggregate's explicit rule. Real Postgres and the real permission
 * engine: the claims are about which rows come back and who may read them.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { AGGREGATE_PROJECT_KIND } from "../project-kinds";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

describe("Feature: an admin picks the projects a new aggregate reads", () => {
  let fixture: AggregateFixture;

  const listAsAdmin = () =>
    callerFor(fixture.admin.id).project.aggregateMemberCandidates({
      organizationId: fixture.organizationId,
    });

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, {
      label: "agg-candidates",
    });
  });

  afterAll(async () => {
    await resetApp();
    await fixture?.cleanup();
  });

  describe("given two members who each have a personal workspace", () => {
    describe("when the admin lists the projects she may pick", () => {
      /** @scenario "The admin sees every member's personal workspace under Personal projects" */
      it("lists both workspaces as personal, each naming its owner, and the shared project as not personal", async () => {
        const candidates = await listAsAdmin();
        const byId = new Map(candidates.map((c) => [c.id, c]));

        expect(byId.get(fixture.personal.engineer.id)).toMatchObject({
          isPersonal: true,
          owner: { name: fixture.engineer.name, email: fixture.engineer.email },
        });
        expect(byId.get(fixture.personal.seller.id)).toMatchObject({
          isPersonal: true,
          owner: { name: fixture.seller.name, email: fixture.seller.email },
        });
        expect(byId.get(fixture.shared.id)).toMatchObject({
          isPersonal: false,
          owner: null,
        });
      });
    });

    describe("when a member who is not an admin asks for the list", () => {
      /** @scenario "The admin sees every member's personal workspace under Personal projects" */
      it("is refused", async () => {
        await expect(
          callerFor(fixture.member.id).project.aggregateMemberCandidates({
            organizationId: fixture.organizationId,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  describe("given an aggregate project and the hidden governance project", () => {
    describe("when the admin lists the projects she may pick", () => {
      /** @scenario "The project picker leaves out aggregates and the governance project" */
      it("lists neither of them", async () => {
        const aggregate = await fixture.makeAggregate("candidates-aggregate");

        const ids = (await listAsAdmin()).map((c) => c.id);

        expect(ids).not.toContain(aggregate.id);
        expect(ids).not.toContain(fixture.governance.id);
      });
    });
  });

  describe("when the admin creates an aggregate over two listed projects", () => {
    /** @scenario "An admin creates an aggregate from the new project drawer by picking projects" */
    it("stores an explicit rule naming exactly those two", async () => {
      const picked = [fixture.personal.engineer.id, fixture.shared.id];

      const { projectSlug } = await callerFor(fixture.admin.id).project.create({
        organizationId: fixture.organizationId,
        teamId: fixture.team.id,
        name: "Picked view",
        language: "other",
        framework: "other",
        kind: AGGREGATE_PROJECT_KIND,
        aggregateRule: { kind: "explicit", projectIds: picked },
      });

      const stored = await prisma.project.findFirstOrThrow({
        where: { slug: projectSlug, teamId: fixture.team.id },
      });
      expect(stored.kind).toBe(AGGREGATE_PROJECT_KIND);
      expect(stored.aggregateRule).toEqual({
        kind: "explicit",
        projectIds: picked,
      });
    });
  });
});
