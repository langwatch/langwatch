import type { RunTestSuiteBody } from "@/client-sdk/services/test-suites";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import { parseRunNoteFlag } from "../../utils/runNote";
import { waitForBatchRun } from "../../utils/waitForBatchRun";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { resolveSuiteId } from "./resolveSuite";
import { parseRepeat, parseTargets } from "../run-plans/scopeFlags";
import {
  reportScheduledRun,
  reportSkippedArchived,
} from "../run-plans/reportRun";

export interface RunTestSuiteOptions {
  target?: string[];
  name?: string;
  repeat?: string;
  simulatorModel?: string;
  judgeModel?: string;
  param?: string[];
  note?: string;
  idempotencyKey?: string;
  wait?: boolean;
  format?: string;
}

/**
 * Runs every scenario filed in a test suite against the targets given here.
 *
 * The suite holds no targets and no configuration, so both travel with the
 * request. The platform files the run under a run plan named after the suite
 * and its target unless `--name` says otherwise.
 *
 * @see specs/features/suite-cli.feature
 */
export const runTestSuiteCommand = async ({
  reference,
  options,
}: {
  reference: string;
  options: RunTestSuiteOptions;
}): Promise<void> => {
  await resolveCredentials();

  const parameters = parseRunParameterFlags({ pairs: options.param });
  const note = parseRunNoteFlag({ note: options.note });
  const targets = parseTargets(options.target);
  const repeatCount = parseRepeat(options.repeat);

  const service = createCliTestSuitesService();
  const id = await resolveSuiteId({ reference, service });
  const spinner = createSpinner(`Scheduling run for "${reference}"...`).start();

  try {
    const body: RunTestSuiteBody = {
      targets,
      ...(options.name ? { name: options.name } : {}),
      ...(repeatCount !== undefined ? { repeatCount } : {}),
      ...(options.simulatorModel
        ? { simulatorModel: options.simulatorModel }
        : {}),
      ...(options.judgeModel ? { judgeModel: options.judgeModel } : {}),
      ...(options.idempotencyKey
        ? { idempotencyKey: options.idempotencyKey }
        : {}),
      ...(parameters ? { parameters } : {}),
      ...(note ? { note } : {}),
    };

    const result = await service.run(id, body);

    spinner.succeed(
      `Run scheduled under "${result.planName}": ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    // JSON first: the skipped-archived details are already inside the document,
    // and prose printed before it would corrupt the parser's stdout.
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
      action: "run the test suite",
      subject: "test suite run",
    });
  } catch (error) {
    failSpinner({ spinner, error, action: "run the test suite" });
    process.exit(1);
  }
};
