/**
 * The test suites REST family.
 *
 * A TEST SUITE is a group of scenarios. It holds what it collects and nothing
 * about how a run of it is executed, so the targets, the repeat count and the
 * models arrive with the run request and are written onto the run plan that
 * run resolves.
 *
 * Run plans are the other half of the model and live in their own family,
 * `/api/v1/run-plans`. `/api/suites` is the deprecated alias that predates the
 * split.
 */

import { randomUUID } from "node:crypto";
import type { BaseApp, VersionBuilder } from "@langwatch/api";
import { z } from "zod";
import { runActorOf } from "~/app/api/shared/run-actor";
import {
  queryBoolean,
  runPlanRunResultSchema,
  type TestSuiteWire,
  testSuiteDetailSchema,
  testSuiteRunInputSchema,
  testSuiteSchema,
  toRunItemsWire,
  toTestSuiteWire,
} from "~/app/api/shared/suite-wire";
import type { Project, SimulationSuite } from "~/generated/prisma/client";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { ProjectRepository } from "~/server/projects/project.repository";
import { SuiteNotFoundError } from "~/server/suites/errors";
import { MAX_PLAN_NAME_LENGTH } from "~/server/suites/plan-name";
import { suitePlatformPath } from "~/server/suites/platform-path";
import { SuiteService } from "~/server/suites/suite.service";
import { platformUrl } from "../../shared/platform-url";

const { service, guard } = createProjectService({
  name: "test-suites",
  basePath: "/api/v1/test-suites",
});

type TestSuitesApp = BaseApp<Project> & {
  suites: SuiteService;
  organizationId: string;
};
type TestSuitesVersion = VersionBuilder<TestSuitesApp>;

const idParamsSchema = z.object({
  id: z.string().min(1).describe("The test suite id."),
});

const listQuerySchema = z.object({
  includeArchived: queryBoolean.describe(
    "Include archived test suites in the list. true, 1, yes for yes; false, 0, no or omitted for no.",
  ),
});

const nameInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(MAX_PLAN_NAME_LENGTH)
    .describe("The test suite name, as it reads in the platform."),
});

const archiveResultSchema = z.object({
  id: z.string().describe("The test suite that was archived."),
  archived: z.literal(true).describe("Always true once the suite is archived."),
});

// ── wire helpers ─────────────────────────────────────────────────────────────

/** Where this suite opens in the platform, for the project's own interface. */
async function suiteUrl({
  app,
  suite,
}: {
  app: TestSuitesApp;
  suite: SimulationSuite;
}): Promise<string> {
  const path = await suitePlatformPath({
    projectId: app.project.id,
    organizationId: app.organizationId,
    slug: suite.slug,
    kind: "test_suite",
  });
  return platformUrl({ projectSlug: app.project.slug, path });
}

async function suiteWire({
  app,
  suite,
}: {
  app: TestSuitesApp;
  suite: SimulationSuite;
}): Promise<TestSuiteWire> {
  return toTestSuiteWire({
    suite,
    platformUrl: await suiteUrl({ app, suite }),
  });
}

/**
 * What a run of a test suite answers with.
 *
 * The run is filed under a RUN PLAN, so the link it hands back opens that plan
 * rather than the suite: the results live with the plan.
 */
async function runResultWire({
  app,
  result,
}: {
  app: TestSuitesApp;
  result: Awaited<ReturnType<SuiteService["runTestSuite"]>>;
}) {
  const plan = await app.suites.getById({
    id: result.suiteId,
    projectId: app.project.id,
  });
  if (!plan) throw new SuiteNotFoundError("Run plan not found");
  const path = await suitePlatformPath({
    projectId: app.project.id,
    organizationId: app.organizationId,
    slug: plan.slug,
    kind: "run_plan",
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
    platformUrl: platformUrl({ projectSlug: app.project.slug, path }),
  };
}

// ── endpoint registration ────────────────────────────────────────────────────

const registerCollectionEndpoints = (v: TestSuitesVersion): void => {
  v.get(
    "/",
    {
      ...guard("scenarios:view"),
      query: listQuerySchema,
      output: z.array(testSuiteSchema),
      description:
        "List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.",
      docs: { operationId: "listTestSuites", tags: ["Test Suites"] },
    },
    async (
      _c,
      {
        query,
        app,
      }: { query: { includeArchived: boolean }; app: TestSuitesApp },
    ) => {
      const suites = await app.suites.getAll({
        projectId: app.project.id,
        kinds: ["test_suite"],
        includeArchived: query.includeArchived,
      });
      return Promise.all(suites.map((suite) => suiteWire({ app, suite })));
    },
  );

  v.post(
    "/",
    {
      ...guard("scenarios:create"),
      input: nameInputSchema,
      output: testSuiteSchema,
      status: 201,
      description:
        "Create a test suite. It starts empty: scenarios join it by being filed into it, and the targets a run goes against are sent with the run.",
      docs: { operationId: "createTestSuite", tags: ["Test Suites"] },
    },
    async (
      _c,
      {
        input,
        app,
      }: { input: z.infer<typeof nameInputSchema>; app: TestSuitesApp },
    ) => {
      const suite = await app.suites.createTestSuite({
        projectId: app.project.id,
        name: input.name,
      });
      return suiteWire({ app, suite });
    },
  );
};

const registerItemEndpoints = (v: TestSuitesVersion): void => {
  v.get(
    "/:id",
    {
      ...guard("scenarios:view"),
      params: idParamsSchema,
      output: testSuiteDetailSchema,
      description:
        "Read one test suite with the scenarios filed in it, named. An id the project does not hold, and a run plan id, both answer 404 suite_not_found.",
      docs: {
        summary: "Read one test suite",
        operationId: "getTestSuite",
        tags: ["Test Suites"],
      },
    },
    async (
      _c,
      { params, app }: { params: { id: string }; app: TestSuitesApp },
    ) => {
      const detail = await app.suites.getTestSuiteDetail({
        projectId: app.project.id,
        testSuiteId: params.id,
      });
      return {
        ...(await suiteWire({ app, suite: detail })),
        scenarios: detail.scenarios,
      };
    },
  );

  v.patch(
    "/:id",
    {
      ...guard("scenarios:update"),
      params: idParamsSchema,
      input: nameInputSchema,
      output: testSuiteSchema,
      description:
        "Rename a test suite. The slug is kept, so links and run history stay where they are.",
      docs: { operationId: "renameTestSuite", tags: ["Test Suites"] },
    },
    async (
      _c,
      {
        params,
        input,
        app,
      }: {
        params: { id: string };
        input: z.infer<typeof nameInputSchema>;
        app: TestSuitesApp;
      },
    ) => {
      const suite = await app.suites.renameTestSuite({
        projectId: app.project.id,
        testSuiteId: params.id,
        name: input.name,
      });
      return suiteWire({ app, suite });
    },
  );
};

const registerArchiveEndpoint = (v: TestSuitesVersion): void => {
  v.delete(
    "/:id",
    {
      ...guard("scenarios:manage"),
      params: idParamsSchema,
      output: archiveResultSchema,
      description:
        "Archive a test suite. The scenarios filed in it are archived with it, in one step, because the suite is where they live.",
      docs: { operationId: "archiveTestSuite", tags: ["Test Suites"] },
    },
    async (
      _c,
      { params, app }: { params: { id: string }; app: TestSuitesApp },
    ) => {
      await app.suites.archiveTestSuite({
        projectId: app.project.id,
        testSuiteId: params.id,
      });
      return { id: params.id, archived: true as const };
    },
  );
};

const registerRunEndpoint = (v: TestSuitesVersion): void => {
  v.post(
    "/:id/run",
    {
      ...guard("scenarios:create"),
      params: idParamsSchema,
      input: testSuiteRunInputSchema,
      output: runPlanRunResultSchema,
      description:
        "Run every scenario filed in the test suite against the targets sent with the request. The run is filed under a run plan named after the suite and its targets unless a name is sent. A request that names no target answers 422 suite_targets_required.",
      docs: {
        summary: "Run a test suite",
        operationId: "runTestSuite",
        tags: ["Test Suites"],
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
        input: z.infer<typeof testSuiteRunInputSchema>;
        app: TestSuitesApp;
      },
    ) => {
      const actor = runActorOf(c);
      const result = await app.suites.runTestSuite({
        projectId: app.project.id,
        organizationId: app.organizationId,
        testSuiteId: params.id,
        targets: input.targets,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.repeatCount !== undefined && {
          repeatCount: input.repeatCount,
        }),
        ...(input.simulatorModel !== undefined && {
          simulatorModel: input.simulatorModel,
        }),
        ...(input.judgeModel !== undefined && { judgeModel: input.judgeModel }),
        idempotencyKey: input.idempotencyKey ?? `api-${randomUUID()}`,
        ...(input.parameters !== undefined && { parameters: input.parameters }),
        ...(input.note !== undefined && { note: input.note }),
        ...(actor !== undefined && { actor }),
      });
      return runResultWire({ app, result });
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
    registerArchiveEndpoint(v);
    registerRunEndpoint(v);
  })
  .build();
