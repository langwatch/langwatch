import type { RunPlanRunBody } from "@/client-sdk/services/run-plans";
import { createSpinner } from "../../utils/spinner.ts";
import { resolveCredentials } from "../../utils/apiKey.ts";
import { failSpinner } from "../../utils/spinnerError.ts";
import { parseRunParameterFlags } from "../../utils/keyValueFlags.ts";
import { parseRunNoteFlag } from "../../utils/runNote.ts";
import type { RawOutputFlags } from "../../utils/output.ts";
import { createCliRunPlansService } from "./cli-run-plans-service.ts";
import { createCliTestSuitesService } from "../test-suites/cli-test-suites-service.ts";
import { type EvaluatorFlagRef, readEvaluators } from "../test-suites/evaluatorFlags.ts";
import {
  buildScope,
  parseRepeat,
  parseWait,
  parseTargets,
  type ScopeOptions,
} from "./scopeFlags.ts";
import { emitRunResult } from "./reportRun.ts";

export interface RunPlanRunOptions extends ScopeOptions, RawOutputFlags {
  target?: string[];
  name?: string;
  repeat?: string;
  simulatorModel?: string;
  judgeModel?: string;
  param?: string[];
  note?: string;
  idempotencyKey?: string;
  wait?: boolean | string;
  /** `--evaluator <id|slug>`, in the order written, each with its gate flag. */
  evaluators?: EvaluatorFlagRef[];
  /** `--evaluators-json <file|json>`: the plan's full attachment list. */
  evaluatorsJson?: string;
}

/**
 * Runs a configuration under a name: an existing name joins that plan's
 * history, a new name creates the plan, no name lets the platform derive one.
 * @see specs/features/run-plan-cli.feature
 */
export const runRunPlanCommand = async (options: RunPlanRunOptions): Promise<void> => {
  await resolveCredentials();

  // Everything the caller wrote is read before anything is scheduled, so a
  // malformed line never leaves a half-started batch behind.
  const parameters = parseRunParameterFlags({ pairs: options.param });
  const note = parseRunNoteFlag({ note: options.note });
  const targets = parseTargets(options.target);
  const repeatCount = parseRepeat(options.repeat);
  const wait = parseWait(options.wait);
  const { scope, scenarioIds } = await buildScope(options, createCliTestSuitesService());
  // A plan evaluator reads the conversation and the trace, never a scenario
  // field: the plan may cover scenarios from suites with different fields.
  const evaluators = await readEvaluators({ options, fields: [], isPlanLevel: true });

  const service = createCliRunPlansService();
  const spinner = createSpinner("Scheduling run...").start();

  try {
    const body: RunPlanRunBody = {
      ...(options.name ? { name: options.name } : {}),
      config: {
        scope,
        targets,
        ...(scenarioIds ? { scenarioIds } : {}),
        ...(repeatCount !== undefined ? { repeatCount } : {}),
        ...(options.simulatorModel ? { simulatorModel: options.simulatorModel } : {}),
        ...(options.judgeModel ? { judgeModel: options.judgeModel } : {}),
        ...(evaluators !== undefined ? { evaluators } : {}),
      },
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(parameters ? { parameters } : {}),
      ...(note ? { note } : {}),
    };

    const result = await service.run(body);

    spinner.succeed(
      `Run scheduled under "${result.planName}": ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    await emitRunResult({ result, note, options, wait, subject: "run" });
  } catch (error) {
    failSpinner({ spinner, error, action: "run the plan" });
    process.exit(1);
  }
};
