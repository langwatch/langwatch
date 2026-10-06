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
import type { Project } from "~/generated/prisma/client";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import {
  type AggregateFixture,
  realOrganizationService,
  seedAggregateOrganization,
} from "./aggregateProjectFixture";

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

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
