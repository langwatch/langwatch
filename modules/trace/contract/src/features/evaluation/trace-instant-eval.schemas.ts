/**
 * The runs a query's `eval` chips name, and the Explorer's words for what
 * `instantEval.*` answers. The run request and its counters are instant-eval's.
 */
import type {
  ExplorerInstantEvalProgress,
  instantEvalEstimateSchema,
  instantEvalOptInAccessSchema,
  selfHostedInstantEvalOfferSchema,
} from "@langwatch/instant-eval-contract";
import { INSTANT_EVAL_TARGETS, isInstantEvalRunActive } from "@langwatch/instant-eval-contract";
import { z } from "zod";

/** How many runs one query may name: the chip ceiling the search bar holds. */
const EXPLORER_EVAL_RUNS_MAX = 8;

/**
 * The runs the Explorer registered for a query's `eval` chips, one entry per
 * chip key. A read checks each against the project before the compiler binds
 * it, so a key naming a run this project does not own selects nothing.
 * @see specs/traces-v2/instant-eval-search.feature
 */
export const explorerInstantEvalRunsSchema = z
  .record(
    z.string().min(1).max(64),
    z.object({
      question: z.string().min(1).max(2_000),
      target: z.enum(INSTANT_EVAL_TARGETS),
      runId: z.string().min(1).max(200),
    }),
  )
  .refine((runs) => Object.keys(runs).length <= EXPLORER_EVAL_RUNS_MAX, {
    message: "At most eight Instant Eval runs may be registered on one query.",
  })
  .optional();

export type ExplorerInstantEvalRuns = z.infer<typeof explorerInstantEvalRunsSchema>;

/** What an estimate tells the Explorer before a run starts. */
export type ExplorerInstantEvalEstimate = z.infer<typeof instantEvalEstimateSchema>;
/** What `instantEval.access` answers; the browser reads the offer from it. */
export type ExplorerInstantEvalOptInAccess = z.infer<typeof instantEvalOptInAccessSchema>;
/** The self-hosted refusal reasons the Explorer's popover words one by one. */
export type ExplorerSelfHostedInstantEvalOffer = z.infer<typeof selfHostedInstantEvalOfferSchema>;

/**
 * Whether a run the Explorer is watching is still judging. Re-exported here so
 * the Explorer reads one vocabulary: the counters' schema and their meaning.
 */
export function isExplorerInstantEvalRunActive(
  status: ExplorerInstantEvalProgress["status"],
): boolean {
  return isInstantEvalRunActive(status);
}
