/**
 * The Instant Evals REST family.
 *
 * One LangWatchQL statement, judged as a job. The statement is the same one
 * `POST /api/v1/query` runs, so an engineer who has a working query already
 * has a working run: the only extra requirements are a projected `TraceId` and
 * at least one eval function column. The work happens on the queue, which is
 * what lets a hundred thousand rows be a run rather than a request somebody
 * holds open, so creating one answers 202 and progress is polled.
 *
 * Every endpoint is gated twice over. The permission the credential carries is
 * checked by the framework, and then the project's own access to the feature is
 * checked by this family's own middleware. The second check cannot live on the
 * service, because service middleware runs before authentication and there is
 * no project to ask about yet.
 *
 * @see ~/server/app-layer/instant-evals/run: the service this exposes
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import type { BaseApp, VersionBuilder } from "@langwatch/api";
import type { MiddlewareHandler } from "hono";

import type { Project } from "~/generated/prisma/client";
import { getProtectionsForProject } from "~/server/api/utils";
import { createProjectService } from "~/server/api/v1/project-service";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { instantEvalsEnabled } from "~/server/app-layer/instant-evals/access";
import {
  getInstantEvalRunService,
  type InstantEvalRunService,
} from "~/server/app-layer/instant-evals/run";
import { InstantEvalNotEnabledError } from "~/server/app-layer/instant-evals/run/errors";
import { prisma } from "~/server/db";
import type { Protections } from "~/server/traces/protections";
import {
  canonicalConflictResponses,
  canonicalNotFoundResponses,
} from "../../shared/base-responses";
import {
  CANCEL_RUN_DESCRIPTION,
  CREATE_RUN_DESCRIPTION,
  ESTIMATE_RUN_DESCRIPTION,
  GET_RUN_DESCRIPTION,
  LIST_RUNS_DESCRIPTION,
  RESULTS_DESCRIPTION,
  SAMPLE_DESCRIPTION,
} from "./descriptions";
import {
  type InstantEvalListQuery,
  type InstantEvalResultsQuery,
  type InstantEvalRunInputBody,
  type InstantEvalSampleQuery,
  instantEvalIdParamsSchema,
  instantEvalListQuerySchema,
  instantEvalResultsQuerySchema,
  instantEvalRunInputSchema,
  instantEvalSampleQuerySchema,
  toInstantEvalRunInput,
} from "./schemas";
import {
  instantEvalEstimateSchema,
  instantEvalResultsSchema,
  instantEvalRunListSchema,
  instantEvalRunSchema,
  instantEvalSampleSchema,
  toInstantEvalJudgmentWire,
  toInstantEvalRunWire,
} from "./wire";

const { service, guard } = createProjectService({
  name: "instant-evals",
  basePath: "/api/v1/instant-evals",
});

type InstantEvalsApp = BaseApp<Project> & { runs: InstantEvalRunService };
type InstantEvalsVersion = VersionBuilder<InstantEvalsApp>;
type IdParams = { id: string };

const TAGS = ["Instant Evals"];

/**
 * The project's access to the feature.
 *
 * Mounted per endpoint rather than on the service, because the service's own
 * middleware runs before authentication and this check needs the project the
 * credential resolved to.
 */
const requireInstantEvals: MiddlewareHandler = async (c, next) => {
  const project = c.get("project") as Project | undefined;
  if (!project) {
    throw new Error(
      "the Instant Evals gate ran with no authenticated project; mount it after the family's auth middleware",
    );
  }
  if (!(await instantEvalsEnabled({ prisma, projectId: project.id }))) {
    throw new InstantEvalNotEnabledError();
  }
  await next();
};

/** The access declaration and the feature gate, which every endpoint carries. */
const gate = (permission: "analytics:view" | "analytics:manage") => ({
  ...guard(permission),
  middleware: [requireInstantEvals],
});

/** The redaction rules the caller's own reads are bounded by. */
async function protectionsFor(app: InstantEvalsApp): Promise<Protections> {
  return await getProtectionsForProject(prisma, { projectId: app.project.id });
}

// ── endpoint registration ────────────────────────────────────────────────────

const registerCollectionEndpoints = (v: InstantEvalsVersion): void => {
  v.post(
    "/",
    {
      ...gate("analytics:manage"),
      input: instantEvalRunInputSchema,
      output: instantEvalRunSchema,
      status: 202,
      description: CREATE_RUN_DESCRIPTION,
      docs: { operationId: "createInstantEvalRun", tags: TAGS },
    },
    async (
      _c,
      { input, app }: { input: InstantEvalRunInputBody; app: InstantEvalsApp },
    ) =>
      toInstantEvalRunWire(
        await app.runs.create({
          projectId: app.project.id,
          protections: await protectionsFor(app),
          input: toInstantEvalRunInput(input),
        }),
      ),
  );

  v.post(
    "/estimate",
    {
      ...gate("analytics:manage"),
      input: instantEvalRunInputSchema,
      output: instantEvalEstimateSchema,
      description: ESTIMATE_RUN_DESCRIPTION,
      docs: {
        summary: "Estimate a run",
        operationId: "estimateInstantEvalRun",
        tags: TAGS,
      },
    },
    async (
      _c,
      { input, app }: { input: InstantEvalRunInputBody; app: InstantEvalsApp },
    ) =>
      await app.runs.estimate({
        projectId: app.project.id,
        protections: await protectionsFor(app),
        input: toInstantEvalRunInput(input),
      }),
  );

  v.get(
    "/",
    {
      ...gate("analytics:view"),
      query: instantEvalListQuerySchema,
      output: instantEvalRunListSchema,
      description: LIST_RUNS_DESCRIPTION,
      docs: { operationId: "listInstantEvalRuns", tags: TAGS },
    },
    async (
      _c,
      { query, app }: { query: InstantEvalListQuery; app: InstantEvalsApp },
    ) => {
      const rows = await app.runs.list({
        projectId: app.project.id,
        limit: query.limit,
        ...(query.before === undefined
          ? {}
          : { before: new Date(query.before) }),
        ...(query.beforeId === undefined ? {} : { beforeId: query.beforeId }),
      });
      return { runs: rows.map(toInstantEvalRunWire) };
    },
  );
};

const registerItemEndpoints = (v: InstantEvalsVersion): void => {
  v.get(
    "/:id",
    {
      ...gate("analytics:view"),
      params: instantEvalIdParamsSchema,
      output: instantEvalRunSchema,
      description: GET_RUN_DESCRIPTION,
      docs: {
        operationId: "getInstantEvalRun",
        tags: TAGS,
        responses: { ...canonicalNotFoundResponses },
      },
    },
    async (_c, { params, app }: { params: IdParams; app: InstantEvalsApp }) =>
      toInstantEvalRunWire(
        await app.runs.get({ projectId: app.project.id, runId: params.id }),
      ),
  );

  v.post(
    "/:id/cancel",
    {
      ...gate("analytics:manage"),
      params: instantEvalIdParamsSchema,
      output: instantEvalRunSchema,
      description: CANCEL_RUN_DESCRIPTION,
      docs: {
        summary: "Cancel a run",
        operationId: "cancelInstantEvalRun",
        tags: TAGS,
        responses: {
          ...canonicalNotFoundResponses,
          ...canonicalConflictResponses,
        },
      },
    },
    async (c, { params, app }: { params: IdParams; app: InstantEvalsApp }) => {
      const requestedByUserId = c.get("apiKeyUserId") as string | undefined;
      const row = await app.runs.cancel({
        projectId: app.project.id,
        runId: params.id,
        ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
      });
      return toInstantEvalRunWire(row);
    },
  );
};

const registerResultsEndpoint = (v: InstantEvalsVersion): void => {
  v.get(
    "/:id/results",
    {
      ...gate("analytics:view"),
      params: instantEvalIdParamsSchema,
      query: instantEvalResultsQuerySchema,
      output: instantEvalResultsSchema,
      description: RESULTS_DESCRIPTION,
      docs: {
        summary: "Read a run's results",
        operationId: "listInstantEvalRunResults",
        tags: TAGS,
      },
    },
    async (
      _c,
      {
        params,
        query,
        app,
      }: {
        params: IdParams;
        query: InstantEvalResultsQuery;
        app: InstantEvalsApp;
      },
    ) => {
      const page = await app.runs.results({
        projectId: app.project.id,
        runId: params.id,
        limit: query.limit,
        ...(query.questionId === undefined
          ? {}
          : { questionId: query.questionId }),
        ...(query.matched === undefined ? {} : { isMatched: query.matched }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      });
      return {
        judgments: page.judgments.map(toInstantEvalJudgmentWire),
        ...(page.nextCursor === undefined
          ? {}
          : { nextCursor: page.nextCursor }),
      };
    },
  );
};

const registerSampleEndpoint = (v: InstantEvalsVersion): void => {
  v.get(
    "/:id/sample",
    {
      ...gate("analytics:view"),
      params: instantEvalIdParamsSchema,
      query: instantEvalSampleQuerySchema,
      output: instantEvalSampleSchema,
      description: SAMPLE_DESCRIPTION,
      docs: {
        summary: "Sample a run",
        operationId: "sampleInstantEvalRun",
        tags: TAGS,
      },
    },
    async (
      _c,
      {
        params,
        query,
        app,
      }: {
        params: IdParams;
        query: InstantEvalSampleQuery;
        app: InstantEvalsApp;
      },
    ) => {
      const sample = await app.runs.sample({
        projectId: app.project.id,
        protections: await protectionsFor(app),
        runId: params.id,
        n: query.n,
      });
      return {
        rows: sample.rows.map((row) => ({ ...row })),
        judgments: sample.judgments.map(toInstantEvalJudgmentWire),
      };
    },
  );
};

// ── service wiring ───────────────────────────────────────────────────────────

export const app = service
  .provide({
    // Resolved per request rather than captured at module load, which is what
    // lets a suite stand the service up on fakes before the first call.
    runs: () => getInstantEvalRunService(),
  })
  .version(V1_API_VERSION, (v) => {
    registerCollectionEndpoints(v);
    registerItemEndpoints(v);
    registerResultsEndpoint(v);
    registerSampleEndpoint(v);
  })
  .build();
