/**
 * What a failed Instant Eval run says: why it stopped, as far as the code it
 * carries tells, and whether anything was charged.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { ExplorerInstantEvalProgress } from "@langwatch/instant-eval-contract";

const REACH = "Instant Evals could not reach LangWatch.";
const LICENSE_OFF = "This license does not include Instant Evals.";

const FAILURE_REASONS: Readonly<Record<string, string>> = {
  connect_unreachable: REACH,
  hosted_service_unavailable: REACH,
  connect_license_revoked: "This license is no longer active, so Instant Evals are off.",
  connect_license_expired: "This license has expired, so Instant Evals are off.",
  connect_license_required: LICENSE_OFF,
  connect_service_not_entitled: LICENSE_OFF,
  connect_disabled: "Hosted services are switched off for this install.",
  connect_budget_exhausted: "The hosted usage budget for this license is spent.",
  instant_eval_classifier_unavailable: "The judge did not answer.",
  instant_eval_stalled: "This Instant Eval stopped before it finished.",
};

const UNKNOWN_REASON = "This Instant Eval could not finish.";

/** The failure in one or two sentences: the reason, then what it cost. */
export function instantEvalFailureMessage({
  run,
}: {
  run: Pick<ExplorerInstantEvalProgress, "error" | "priceUsd">;
}): string {
  const reason =
    run.error !== null && Object.hasOwn(FAILURE_REASONS, run.error)
      ? (FAILURE_REASONS[run.error] ?? UNKNOWN_REASON)
      : UNKNOWN_REASON;
  const charge = run.priceUsd > 0 ? "Only the rows judged were charged." : "Nothing was charged.";
  return `${reason} ${charge}`;
}

/** The first eval chip whose run failed, with that run, or null. */
export function failedInstantEvalChip<
  Chip extends { key: string; runId: string | null },
  Run extends { status: string },
>({
  chips,
  runs,
}: {
  chips: readonly Chip[];
  runs: Readonly<Record<string, Run>>;
}): { chip: Chip; run: Run } | null {
  for (const chip of chips) {
    const run = chip.runId === null ? undefined : runs[chip.runId];
    if (run?.status === "failed") return { chip, run };
  }
  return null;
}
