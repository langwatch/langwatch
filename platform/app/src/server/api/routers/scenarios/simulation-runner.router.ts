/**
 * Router for running scenarios against targets.
 */

import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { launchScenarioRun } from "~/server/scenarios/launch-scenario-run.service";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import type { RunActor } from "~/server/scenarios/run-actor";
import { runNoteSchema } from "~/server/scenarios/run-note";
import { simulationTargetSchema } from "~/server/scenarios/simulation-target";
import { projectSchema } from "./schemas";

const runScenarioSchema = projectSchema.extend({
  scenarioId: z.string(),
  target: simulationTargetSchema,
  /**
   * Where the run is recorded. Defaults to this project's one-off bucket.
   *
   * A caller may name an EXTERNAL set, the address its own code pushes
   * scenario events under. It may not name an internal one: see
   * `assertWritableSetId` in the launch service.
   */
  setId: z.string().optional(),
  /** Optional client-generated batch run ID for immediate placeholder feedback */
  batchRunId: z.string().optional(),
  /**
   * Constant values for the run. A value supplied here overrides the
   * scenario's own default for that name.
   */
  parameters: runParameterValuesSchema.optional(),
  /** One short line describing why this run was started. */
  note: runNoteSchema,
});

/**
 * Simulation runner - executing scenarios against targets.
 */
export const simulationRunnerRouter = createTRPCRouter({
  /**
   * Run a scenario against a target.
   *
   * Schedules the scenario for async execution and returns immediately
   * with the batch run ID for tracking. Does NOT return success/failure
   * of scenario execution - that happens asynchronously.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const actor: RunActor = { id: ctx.session.user.id, label: "user" };

      return launchScenarioRun({
        prisma: ctx.prisma,
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        target: input.target,
        actor,
        setId: input.setId,
        batchRunId: input.batchRunId,
        parameters: input.parameters,
        note: input.note,
      });
    }),
});
