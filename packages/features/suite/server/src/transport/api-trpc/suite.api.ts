/**
 * Simulation suite configurations over the process's tRPC transport.
 *
 * CRUD, duplicate, archive and run, plus the test suite sub-surface mounted at
 * `suites.testSuites.*`.
 *
 * Transport only: gates, input parsing and delegation to `SuiteApp`. The
 * decisions a suite id makes — try the run plan, fall back to the test suite;
 * refuse a scope or a member list on a test suite; resolve the project's
 * organization — are the application's, and the REST family reaches the same
 * ones.
 */
import {
  runNoteSchema,
  runParameterValuesSchema,
  type SuiteRunSummary,
} from "@langwatch/scenario-contract";
import { SUITE_KINDS, tryExtractSuiteId } from "@langwatch/suite-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { createTestSuiteRouter } from "./test-suite.api";
import {
  createSuiteSchema,
  projectSchema,
  runPlanSchema,
  suiteTargetSchema,
  updateSuiteSchema,
} from "./suite.schemas";
import type { SuiteTrpcContext, SuiteTrpcProcedures } from "./suite.trpc-context";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Installs the complete `suites.*` tRPC surface on a process-owned root. */
export class SuiteTrpcApi {
  static create<
    TContext extends SuiteTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: SuiteTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      testSuites: createTestSuiteRouter(trpc, procedures),

      create: policy("scenarios:manage")(procedure.input(createSuiteSchema)).mutation(
        async ({ ctx, input }) => {
          return ctx.app.suites.create(input);
        },
      ),

      // The kinds default is "custom" inside the service: v1 callers name no
      // kind and must never receive test suite rows. v2 callers name what they want.
      getAll: policy("scenarios:view")(
        procedure.input(
          projectSchema.extend({
            kinds: z.array(z.enum(SUITE_KINDS)).min(1).optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const kinds = input.kinds ?? ["run_plan"];
        const [suites, testSuites] = await Promise.all([
          kinds.includes("run_plan")
            ? ctx.app.suites.list({ projectId: input.projectId })
            : Promise.resolve([]),
          kinds.includes("test_suite")
            ? ctx.app.suites.listTestSuites({ projectId: input.projectId })
            : Promise.resolve([]),
        ]);

        return [...suites, ...testSuites].sort(
          (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
        );
      }),

      getById: policy("scenarios:view")(
        procedure.input(projectSchema.extend({ id: z.string() })),
      ).query(async ({ ctx, input }) => {
        const found = await ctx.app.suites.getByIdOrTestSuite(input);
        return found.kind === "suite" ? found.suite : found.testSuite;
      }),

      update: policy("scenarios:manage")(procedure.input(updateSuiteSchema)).mutation(
        async ({ ctx, input }) => {
          const updated = await ctx.app.suites.update(input);
          return updated.kind === "suite" ? updated.suite : updated.testSuite;
        },
      ),

      duplicate: policy("scenarios:manage")(
        procedure.input(projectSchema.extend({ id: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        return ctx.app.suites.duplicate(input);
      }),

      archive: policy("scenarios:manage")(
        procedure.input(projectSchema.extend({ id: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        return ctx.app.suites.archive(input);
      }),

      resolveArchivedNames: policy("scenarios:view")(
        procedure.input(
          z.object({
            projectId: z.string(),
            scenarioIds: z.array(z.string()),
            targets: z.array(suiteTargetSchema),
          }),
        ),
      ).query(async ({ ctx, input }) => ctx.app.suites.resolveArchivedNames(input)),

      run: policy("scenarios:manage")(
        procedure.input(
          projectSchema.extend({
            id: z.string(),
            idempotencyKey: z.string(),
            /** Optional client-generated batch run ID for immediate placeholder feedback */
            batchRunId: z.string().optional(),
            /**
             * Constant values applied to every scenario in the run. A value
             * supplied here overrides the scenario's own default for that name.
             */
            parameters: runParameterValuesSchema.optional(),
            /**
             * One short line describing why this batch was run, stamped onto every
             * run of the batch.
             */
            note: runNoteSchema,
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        // No catch: a Suite execution error is a HandledError, so the tRPC
        // handled-error middleware maps its code and status. Wrapping it in an
        // INTERNAL_SERVER_ERROR here would drop the `cause` the middleware keys
        // off, turning "every scenario is archived" — a customer-fault 422 the
        // UI has a specific recovery action for — into an opaque 500. The
        // project's organization is the application's to resolve, and it
        // refuses with `organization_not_found_for_project` when it cannot.
        const result = await ctx.app.suites.run({
          id: input.id,
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
          batchRunId: input.batchRunId,
          parameters: input.parameters,
          note: input.note,
          // A run started here was started by the signed-in person in front of
          // the app, so the surface it records is "user".
          actor: { id: ctx.actor().id, label: "user" },
        });

        return {
          scheduled: true,
          ...result,
        };
      }),

      /**
       * Starts a run under a name, which is what identifies a run plan: the
       * name either joins an existing plan and replaces its config, or
       * creates one.
       *
       * Separate from `run` on purpose. `run` takes a plan id; this one is
       * the run dialog's single entry point for all of its scenarios — hand
       * a scope, some targets and a name, and get a plan back either way.
       *
       * @see specs/suites/run-plan-identity-by-name.feature
       */
      runPlan: policy("scenarios:manage")(procedure.input(runPlanSchema)).mutation(
        async ({ ctx, input }) => {
          // No catch: a Suite execution error is a HandledError, so the tRPC
          // handled-error middleware maps its code and status.
          const result = await ctx.app.suites.runPlan({
            projectId: input.projectId,
            name: input.name,
            config: input.config,
            idempotencyKey: input.idempotencyKey,
            batchRunId: input.batchRunId,
            parameters: input.parameters,
            note: input.note,
            actor: { id: ctx.actor().id, label: "user" },
          });
          return { scheduled: true, ...result };
        },
      ),

      /**
       * Runs every non-archived test case of the project through the managed
       * "All test cases" suite (created on first use, refreshed at each run).
       */
      runAll: policy("scenarios:manage")(
        procedure.input(
          projectSchema.extend({
            idempotencyKey: z.string(),
            /** Optional client-generated batch run ID for immediate placeholder feedback */
            batchRunId: z.string().optional(),
            /** Targets chosen in the run dialog; persisted for the next run's preselect. */
            targets: z.array(suiteTargetSchema).optional(),
            parameters: runParameterValuesSchema.optional(),
            note: runNoteSchema,
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
        const result = await ctx.app.suites.runAll({
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
          batchRunId: input.batchRunId,
          targets: input.targets,
          parameters: input.parameters,
          note: input.note,
          actor: { id: ctx.actor().id, label: "user" },
        });
        return {
          scheduled: true,
          ...result,
        };
      }),

      getSummaries: policy("scenarios:view")(
        procedure.input(
          projectSchema.extend({
            startDate: z.number().int().nonnegative().optional(),
            endDate: z.number().int().nonnegative().optional(),
          }),
        ),
      ).query(async ({ ctx, input }) => {
        const startDate = input.startDate ?? Date.now() - THIRTY_DAYS_MS;
        const endDate = input.endDate ?? Date.now();

        const summaries = await ctx.app.suites.getInternalSuiteSummaries({
          projectId: input.projectId,
          startDate,
          endDate,
        });

        const result: Record<string, SuiteRunSummary> = {};
        for (const summary of summaries) {
          const suiteId = tryExtractSuiteId(summary.scenarioSetId);
          if (!suiteId) continue;
          result[suiteId] = {
            passedCount: summary.passedCount,
            failedCount: summary.failedCount,
            totalCount: summary.totalCount,
            lastRunTimestamp: summary.lastRunTimestamp,
          };
        }
        return result;
      }),
    });
  }
}
