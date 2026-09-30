/**
 * `langwatch instant-eval estimate`: what a run would read and what it would
 * cost, with nothing judged and nothing charged.
 *
 * Takes the same inputs `run` does, so a line that prices a run is the same
 * line that starts it with the word changed. That is the whole reason it is its
 * own subcommand as well as a flag on `run`: an agent about to spend money
 * reads better asking for an estimate than remembering a flag.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import type { InstantEvalEstimate } from "@/client-sdk/services/instant-evals";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult, RawOutputFlags } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { createCliInstantEvalsService } from "./cli-instant-evals-service";
import type { QuestionDraft } from "./questionFlags";
import { estimateLine, printEstimate } from "./render";
import { buildInstantEvalRunBody, type InstantEvalRunFlags } from "./runInput";

export const estimateInstantEvalCommand = async (
  instructions: string | undefined,
  options: InstantEvalRunFlags & RawOutputFlags,
  drafts: readonly QuestionDraft[],
): Promise<CommandResult | void> => {
  await resolveCredentials();

  const body = await buildInstantEvalRunBody({
    ...(instructions === undefined ? {} : { instructions }),
    drafts,
    flags: options,
  });

  const service = createCliInstantEvalsService();
  const spinner = createSpinner("Pricing the run...").start();

  try {
    const estimate: InstantEvalEstimate = await service.estimate(body);
    spinner.succeed(estimateLine(estimate));

    return { data: estimate, table: () => printEstimate(estimate) };
  } catch (error) {
    failSpinner({ spinner, error, action: "estimate an instant eval run" });
    process.exit(1);
  }
};
