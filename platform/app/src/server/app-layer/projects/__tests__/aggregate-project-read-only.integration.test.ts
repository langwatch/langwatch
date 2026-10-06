/**
 * @vitest-environment node
 *
 * ADR-144 decision 8: the aggregate is read only in v1. Its navigation is
 * Analytics and Traces, and no monitor can be created on it: the refusal is
 * the server's, so a hidden button is a convenience and not the guard.
 * Driven as an organisation admin, who passes every permission involved.
 *
 * @see specs/governance/aggregate-project.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project } from "~/generated/prisma/client";
import { projectNavigation } from "~/components/sidebar/projectKindNavigation";
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

const handledCodeOf = (error: unknown): string | undefined => {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (HandledError.isHandled(cause)) return cause.code;
  return HandledError.isHandled(error) ? error.code : undefined;
};

describe("Feature: the aggregate project is read only", () => {
  let fixture: AggregateFixture;
  let aggregate: Project;
  let admin: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    globalForApp.__langwatch_app = createTestApp({
      organizations: realOrganizationService(prisma),
    });
    fixture = await seedAggregateOrganization(prisma, { label: "agg-ro" });
    aggregate = await fixture.makeAggregate("company-view");
    admin = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: fixture.admin.id }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await resetApp();
    await prisma.monitor.deleteMany({ where: { projectId: aggregate?.id } });
    await fixture?.cleanup();
  });

  /** @scenario "Test, Build and Online Evals are hidden on the aggregate" */
  describe("given an organisation admin opening the aggregate", () => {
    describe("when its navigation is built", () => {
      it("shows Traces and Analytics, and no Prompts, Experiments or Online Evaluations", async () => {
        const organizations = await admin.organization.getAll({});
        const opened = organizations
          .flatMap((organization) => organization.teams)
          .flatMap((team) => team.projects)
          .find((project) => project.id === aggregate.id);
        expect(opened).toBeDefined();

        const navigation = projectNavigation(opened?.kind);
        expect(navigation.observe).toBe(true);
        expect(navigation.onlineEvaluations).toBe(false);
        expect(navigation.test).toBe(false);
        expect(navigation.build).toBe(false);
      });
    });

    describe("when a monitor is created on the aggregate", () => {
      it("is refused by the server and nothing is written", async () => {
        const refusal = await admin.monitors
          .create({
            projectId: aggregate.id,
            name: "Toxicity",
            checkType: "langevals/basic",
            preconditions: [],
            settings: {},
            sample: 1,
            executionMode: "ON_MESSAGE",
            evaluatorId: "evaluator_does_not_matter",
          })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(handledCodeOf(refusal)).toBe("monitor_on_aggregate_project");
        expect(
          await prisma.monitor.count({ where: { projectId: aggregate.id } }),
        ).toBe(0);
      });
    });

    describe("when a monitor is copied into the aggregate", () => {
      it("is refused as well", async () => {
        const refusal = await admin.monitors
          .copy({
            monitorId: "monitor_does_not_matter",
            projectId: aggregate.id,
            sourceProjectId: fixture.shared.id,
          })
          .then(() => null)
          .catch((error: unknown) => error);

        expect(handledCodeOf(refusal)).toBe("monitor_on_aggregate_project");
      });
    });
  });
});
