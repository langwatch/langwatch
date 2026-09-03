import type { RunPlanRunBody } from "@/client-sdk/services/run-plans";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import { parseRunNoteFlag } from "../../utils/runNote";
import type { RawOutputFlags } from "../../utils/output";
import { createCliRunPlansService } from "./cli-run-plans-service";
import { createCliTestSuitesService } from "../test-suites/cli-test-suites-service";
import { buildScope, parseRepeat, parseTargets, type ScopeOptions } from "./scopeFlags";
import { emitRunResult } from "./reportRun";

export interface RunPlanRunOptions extends ScopeOptions, RawOutputFlags {
  target?: string[];
  name?: string;
  repeat?: string;
  simulatorModel?: string;
  judgeModel?: string;
  param?: string[];
  note?: string;
  idempotencyKey?: string;
  wait?: boolean;
}

/**
 * Runs a configuration under a name.
 *
 * The name is the plan's identity: an existing name takes this configuration
 * and the run joins that plan's history, a new name creates the plan, and no
 * name lets the platform derive one from the scope and the targets.
 *
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
  const { scope, scenarioIds } = await buildScope(options, createCliTestSuitesService());

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
      },
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(parameters ? { parameters } : {}),
      ...(note ? { note } : {}),
    };

    const result = await service.run(body);

    spinner.succeed(
      `Run scheduled under "${result.planName}": ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    await emitRunResult({ result, note, options, subject: "run" });
  } catch (error) {
    failSpinner({ spinner, error, action: "run the plan" });
    process.exit(1);
  }
};
