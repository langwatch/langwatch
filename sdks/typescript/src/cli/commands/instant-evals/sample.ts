/**
 * `langwatch instant-eval sample <id>`: a few rows with the text that was
 * judged beside the verdict it received.
 *
 * The loop this exists for: run a hundred rows, read five of them in full,
 * see what the judge saw, change the words, run again. Sampling judges nothing
 * and costs nothing, because the text is re-read through the statement's own
 * extraction functions.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import { printSample } from "./render";
import {
  INSTANT_EVAL_SAMPLE_CEILING,
  readCountFlag,
} from "./countFlag";

export const sampleInstantEvalCommand = async (
  id: string,
  options: { number?: string },
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const n = readCountFlag({
    raw: options.number,
    flag: "-n",
    max: INSTANT_EVAL_SAMPLE_CEILING,
  });
  const service = createCliInstantEvalsService();
  const spinner = createSpinner(`Sampling run ${id}...`).start();

  try {
    const sample = await service.sample(id, {
      ...(n === undefined ? {} : { n }),
    });

    spinner.succeed(
      `Read ${sample.rows.length} row${sample.rows.length === 1 ? "" : "s"}`,
    );

    return {
      data: sample,
      table: () =>
        printSample({
          rows: sample.rows as Record<string, unknown>[],
          judgments: sample.judgments,
        }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "sample an instant eval run" });
    process.exit(1);
  }
};
