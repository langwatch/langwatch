import type { RunTestSuiteBody } from "@/client-sdk/services/test-suites";
import { createSpinner } from "../../utils/spinner";
import { resolveCredentials } from "../../utils/apiKey";
import { failSpinner } from "../../utils/spinnerError";
import { parseRunParameterFlags } from "../../utils/keyValueFlags";
import { parseRunNoteFlag } from "../../utils/runNote";
import type { RawOutputFlags } from "../../utils/output";
import { createCliTestSuitesService } from "./cli-test-suites-service";
import { resolveSuiteId } from "./resolveSuite";
import { parseRepeat, parseTargets } from "../run-plans/scopeFlags";
import { emitRunResult } from "../run-plans/reportRun";

export interface RunTestSuiteOptions extends RawOutputFlags {
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
 * Runs every scenario filed in a test suite against the targets given here.
 *
 * The suite holds no targets and no configuration, so both travel with the
 * request. The platform files the run under a run plan named after the suite
 * and its target unless `--name` says otherwise.
 *
 * @see specs/features/test-suite-cli.feature
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
      ...(options.simulatorModel ? { simulatorModel: options.simulatorModel } : {}),
      ...(options.judgeModel ? { judgeModel: options.judgeModel } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(parameters ? { parameters } : {}),
      ...(note ? { note } : {}),
    };

    const result = await service.run(id, body);

    spinner.succeed(
      `Run scheduled under "${result.planName}": ${result.jobCount} job${result.jobCount !== 1 ? "s" : ""} (batch: ${result.batchRunId}${note ? `, note: "${note}"` : ""})`,
    );

    await emitRunResult({ result, note, options, subject: "test suite run" });
  } catch (error) {
    failSpinner({ spinner, error, action: "run the test suite" });
    process.exit(1);
  }
};
