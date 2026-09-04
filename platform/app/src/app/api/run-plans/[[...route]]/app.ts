/**
 * The run plans REST family.
 *
 * A RUN PLAN is what you run, and it is identified by its NAME: a run started
 * under a name joins the plan of that name and replaces its configuration, or
 * creates the plan when nothing answers. That is why the family has both a
 * `POST /run`, which runs a configuration under a name, and a
 * `POST /:id/run`, which runs the configuration a plan already holds.
 *
 * Test suites are the other half of the model and live in their own family,
 * `/api/v1/test-suites`. `/api/suites` is the deprecated alias that predates
 * the split.
 */

import { randomUUID } from "node:crypto";
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import { z } from "zod";
import { runActorOf } from "~/app/api/shared/run-actor";
import {
  queryBoolean,
  type RunPlanWire,
  rerunInputSchema,
  runPlanRunInputSchema,
  runPlanRunResultSchema,
  runPlanSchema,
  toRunItemsWire,
  toRunPlanWire,
} from "~/app/api/shared/suite-wire";
import type { Project, SimulationSuite } from "~/generated/prisma/client";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { ProjectRepository } from "~/server/projects/project.repository";
import { SuiteNotFoundError } from "~/server/suites/errors";
import { suitePlatformPath } from "~/server/suites/platform-path";
import { SuiteService } from "~/server/suites/suite.service";
import { platformUrl } from "../../shared/platform-url";

const { service, guard } = createProjectService({
  name: "run-plans",
  basePath: "/api/v1/run-plans",
});

type RunPlansApp = BaseApp<Project> & {
  suites: SuiteService;
  organizationId: string;
};
type RunPlansVersion = VersionBuilder<RunPlansApp>;

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The run plan id."),
});

const listQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived run plans in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

const archiveResultSchema = z.object({
  id: z.string().describe("The run plan that was archived."),
  archived: z.literal(true).describe("Always true once the plan is archived."),
});

// ── wire helpers ─────────────────────────────────────────────────────────────

/** Where this plan opens in the platform, for the project's own interface. */
async function planUrl({
  app,
  suite,
}: {
  app: RunPlansApp;
  suite: SimulationSuite;
}): Promise<string> {
  const path = await suitePlatformPath({
    projectId: app.project.id,
    organizationId: app.organizationId,
    slug: suite.slug,
    kind: "run_plan",
  });
  return platformUrl({ projectSlug: app.project.slug, path });
}

async function planWire({
  app,
  suite,
}: {
  app: RunPlansApp;
  suite: SimulationSuite;
}): Promise<RunPlanWire> {
  return toRunPlanWire({ suite, platformUrl: await planUrl({ app, suite }) });
}

/**
 * The custom row this id names.
 *
 * A test suite id reads as a missing run plan rather than as a run plan of the
 * wrong kind: the two families address disjoint sets of rows, so an id from
 * one is simply not a member of the other.
 */
async function readPlan({
  app,
  id,
}: {
  app: RunPlansApp;
  id: string;
}): Promise<SimulationSuite> {
  const suite = await app.suites.getById({ id, projectId: app.project.id });
  if (suite?.kind !== "run_plan") {
    throw new SuiteNotFoundError("Run plan not found");
  }
  return suite;
}

// ── endpoint registration ────────────────────────────────────────────────────

const registerCollectionEndpoints = (v: RunPlansVersion): void => {
  v.get(
    "/",
    {
      ...guard("scenarios:view"),
      query: listQuerySchema,
      output: z.array(runPlanSchema),
      description:
        "List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.",
      docs: { operationId: "listRunPlans", tags: ["Run Plans"] },
    },
    async (
      _c,
      { query, app }: { query: { includeArchived: boolean }; app: RunPlansApp },
    ) => {
      const suites = await app.suites.getAll({
        projectId: app.project.id,
        kinds: ["run_plan"],
        includeArchived: query.includeArchived,
      });
      return Promise.all(suites.map((suite) => planWire({ app, suite })));
    },
  );

  v.post(
    "/run",
    {
      ...guard("scenarios:create"),
      input: runPlanRunInputSchema,
      output: runPlanRunResultSchema,
      description:
        "Run a configuration under a name. The name identifies the run plan: send a name already in use and that plan's configuration is replaced with this one, send a new name and the plan is created, send no name and one is derived from what the run covers and what it runs against.",
      docs: { operationId: "runRunPlan", tags: ["Run Plans"] },
    },
    async (
      c,
      {
        input,
        app,
      }: { input: z.infer<typeof runPlanRunInputSchema>; app: RunPlansApp },
    ) => {
      const actor = runActorOf(c);
      const result = await app.suites.runPlan({
        projectId: app.project.id,
        organizationId: app.organizationId,
        ...(input.name !== undefined && { name: input.name }),
        config: input.config,
        idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
        ...(input.parameters !== undefined && { parameters: input.parameters }),
        ...(input.note !== undefined && { note: input.note }),
        ...(actor !== undefined && { actor }),
      });
      return {
        scheduled: true,
        batchRunId: result.batchRunId,
        setId: result.setId,
        jobCount: result.jobCount,
        skippedArchived: result.skippedArchived,
        items: toRunItemsWire(result.items),
        runPlanId: result.suiteId,
        planName: result.planName,
        created: result.created,
        platformUrl: await planUrl({
          app,
          suite: await readPlan({ app, id: result.suiteId }),
        }),
      };
    },
  );
};

const registerItemEndpoints = (v: RunPlansVersion): void => {
  v.get(
    "/:id",
    {
      ...guard("scenarios:view"),
      params: idParamsSchema,
      output: runPlanSchema,
      description:
        "Read one run plan. An id the project does not hold, and a test suite id, both answer 404 suite_not_found.",
      docs: { operationId: "getRunPlan", tags: ["Run Plans"] },
    },
    async (
      _c,
      { params, app }: { params: { id: string }; app: RunPlansApp },
    ) => {
      const suite = await readPlan({ app, id: params.id });
      return planWire({ app, suite });
    },
  );
};

const registerRerunEndpoint = (v: RunPlansVersion): void => {
  v.post(
    "/:id/run",
    {
      ...guard("scenarios:create"),
      params: idParamsSchema,
      input: rerunInputSchema,
      output: runPlanRunResultSchema,
      description:
        "Run a run plan again, with the configuration it already holds. To run a different configuration, post it to /run under the plan's name.",
      docs: {
        summary: "Run a plan again",
        operationId: "rerunRunPlan",
        tags: ["Run Plans"],
      },
    },
    async (
      c,
      {
        params,
        input,
        app,
      }: {
        params: { id: string };
        input: z.infer<typeof rerunInputSchema>;
        app: RunPlansApp;
      },
    ) => {
      const suite = await readPlan({ app, id: params.id });
      const actor = runActorOf(c);
      const result = await app.suites.run({
        suite,
        projectId: app.project.id,
        organizationId: app.organizationId,
        idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
        ...(input.parameters !== undefined && { parameters: input.parameters }),
        ...(input.note !== undefined && { note: input.note }),
        ...(actor !== undefined && { actor }),
      });
      return {
        scheduled: true,
        batchRunId: result.batchRunId,
        setId: result.setId,
        jobCount: result.jobCount,
        skippedArchived: result.skippedArchived,
        items: toRunItemsWire(result.items),
        runPlanId: suite.id,
        planName: suite.name,
        created: false,
        platformUrl: await planUrl({ app, suite }),
      };
    },
  );
};

const registerArchiveEndpoint = (v: RunPlansVersion): void => {
  v.delete(
    "/:id",
    {
      ...guard("scenarios:manage"),
      params: idParamsSchema,
      output: archiveResultSchema,
      description:
        "Archive a run plan. The plan stops being listed and its run history is kept. The scenarios it referenced are left where they are.",
      docs: { operationId: "archiveRunPlan", tags: ["Run Plans"] },
    },
    async (
      _c,
      { params, app }: { params: { id: string }; app: RunPlansApp },
    ) => {
      const suite = await readPlan({ app, id: params.id });
      const archived = await app.suites.archive({
        id: suite.id,
        projectId: app.project.id,
      });
      if (!archived) throw new SuiteNotFoundError("Run plan not found");
      return { id: suite.id, archived: true as const };
    },
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    suites: () =>
      SuiteService.create({
        prisma,
        suiteRunService: getApp().suiteRuns.runs,
      }),
    // A project always belongs to a team, and a team to an organization. A row
    // that says otherwise is broken data the caller can do nothing about, so
    // it degrades to an unknown error with a trace id rather than claiming a
    // cause we cannot name (ADR-045).
    organizationId: async (base) => {
      const organizationId = await new ProjectRepository(
        prisma,
      ).getOrganizationId({ projectId: base.project.id });
      if (!organizationId) {
        throw new Error(
          `Project ${base.project.id} resolves to no organization`,
        );
      }
      return organizationId;
    },
  })
  .version(V1_API_VERSION, (v) => {
    registerCollectionEndpoints(v);
    registerItemEndpoints(v);
    registerRerunEndpoint(v);
    registerArchiveEndpoint(v);
  })
  .build();
