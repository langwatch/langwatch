import type { RunPlanRunBody } from "@/client-sdk/services/run-plans";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import { parseRunNoteFlag } from "../../utils/runNote";
import { waitForBatchRun } from "../../utils/waitForBatchRun";
import { createCliRunPlansService } from "../run-plans/cli-run-plans-service";
import { parseRepeat, parseTargets } from "../run-plans/scopeFlags";
import {
  reportScheduledRun,
  reportSkippedArchived,
} from "../run-plans/reportRun";

export interface RunScenarioOptions {
  target?: string[];
  name?: string;
  repeat?: string;
  param?: string[];
  note?: string;
  idempotencyKey?: string;
  wait?: boolean;
  format?: string;
}

/**
 * Runs one scenario against one or more targets.
 *
 * This is a run plan scoped to a single case: one request, no suite created
 * for it and none deleted afterwards. The platform files the run under a plan
 * named after the scenario and the target unless `--name` says otherwise.
 *
 * @see specs/features/scenario-cli.feature
 */
export const runScenarioCommand = async (
  id: string,
  options: RunScenarioOptions,
): Promise<void> => {
  await resolveCredentials();

  const parameters = parseRunParameterFlags({ pairs: options.param });
  const note = parseRunNoteFlag({ note: options.note });
  const targets = parseTargets(options.target);
  const repeatCount = parseRepeat(options.repeat);

  const service = createCliRunPlansService();
  const spinner = createSpinner(`Scheduling run for scenario "${id}"...`).start();

  try {
    const body: RunPlanRunBody = {
      ...(options.name ? { name: options.name } : {}),
      config: {
        scope: { mode: "cases" },
        scenarioIds: [id],
        targets,
        ...(repeatCount !== undefined ? { repeatCount } : {}),
      },
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      ...(parameters ? { parameters } : {}),
      ...(note ? { note } : {}),
    };

    const result = await service.run(body);

    spinner.succeed(
      `Run scheduled under "${result.planName}": ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    if (options.format === "json") {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    reportSkippedArchived(result);

    if (!options.wait) {
      reportScheduledRun({ result, note });
      return;
    }

    await waitForBatchRun({
      batchRunId: result.batchRunId,
      jobCount: result.jobCount,
      action: "run the scenario",
      subject: "scenario run",
    });
  } catch (error) {
    failSpinner({ spinner, error, action: "run the scenario" });
    process.exit(1);
  }
};
