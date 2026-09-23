/**
 * `langwatch instant-eval results <id>`: one keyset page of judgements. The returned cursor is the
 * only way to the next page, so none repeats or is skipped while a run still writes.
 * @see specs/features/instant-eval-cli.feature
 */

import { resolveCredentials } from "../../utils/apiKey";
import { commandValidationError, reportCommandError } from "../../utils/errorOutput";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import { INSTANT_EVAL_RESULTS_CEILING, readCountFlag } from "./countFlag";
import { printJudgments } from "./render";

/** The states a judgement can be read back in. */
const JUDGMENT_STATUSES = ["judged", "skipped", "failed"] as const;

export interface InstantEvalResultsOptions {
  question?: string;
  matched?: boolean;
  unmatched?: boolean;
  status?: string;
  limit?: string;
  cursor?: string;
}

export const resultsInstantEvalCommand = async (
  id: string,
  options: InstantEvalResultsOptions,
): Promise<CommandResult | void> => {
  await resolveCredentials();

  if (options.matched && options.unmatched) {
    reportCommandError({
      error: commandValidationError(
        "Use --matched, or --unmatched, not both. Omit both to read every judgement.",
      ),
    });
    process.exit(1);
  }
  if (
    options.status !== undefined &&
    !(JUDGMENT_STATUSES as readonly string[]).includes(options.status)
  ) {
    reportCommandError({
      error: commandValidationError(
        `Invalid --status value: ${options.status} (a judgement is ${JUDGMENT_STATUSES.join(", ")})`,
      ),
    });
    process.exit(1);
  }

  const isMatched = options.matched || (options.unmatched ? false : undefined);
  const limit = readCountFlag({
    raw: options.limit,
    flag: "--limit",
    max: INSTANT_EVAL_RESULTS_CEILING,
  });
  const service = createCliInstantEvalsService();
  const spinner = createSpinner(`Reading judgements for ${id}...`).start();

  try {
    const page = await service.results(id, {
      ...(options.question === undefined ? {} : { questionId: options.question }),
      ...(isMatched === undefined ? {} : { isMatched }),
      ...(options.status === undefined
        ? {}
        : { status: options.status as "judged" | "skipped" | "failed" }),
      ...(limit === undefined ? {} : { limit }),
      ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    });

    spinner.succeed(
      `Read ${page.judgments.length} judgement${page.judgments.length === 1 ? "" : "s"}`,
    );

    return {
      data: page,
      table: () =>
        printJudgments({
          judgments: page.judgments,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "read instant eval results" });
    process.exit(1);
  }
};
