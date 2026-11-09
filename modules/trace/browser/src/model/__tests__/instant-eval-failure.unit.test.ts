/**
 * The words a failed Instant Eval run is shown with.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import { failedInstantEvalChip, instantEvalFailureMessage } from "../instant-eval-failure.ts";

describe("instantEvalFailureMessage", () => {
  /** @scenario "A failed run says why, as far as the server knows" */
  it.each([
    ["connect_unreachable", 0, "Instant Evals could not reach LangWatch. Nothing was charged."],
    [
      "hosted_service_unavailable",
      0,
      "Instant Evals could not reach LangWatch. Nothing was charged.",
    ],
    [
      "connect_license_revoked",
      0,
      "This license is no longer active, so Instant Evals are off. Nothing was charged.",
    ],
    ["instant_eval_classifier_unavailable", 0, "The judge did not answer. Nothing was charged."],
    [
      "instant_eval_stalled",
      0.02,
      "This Instant Eval stopped before it finished. Only the rows judged were charged.",
    ],
  ])("words %s with %s charged", (error, priceUsd, message) => {
    expect(instantEvalFailureMessage({ run: { error, priceUsd } })).toBe(message);
  });

  it("falls back to a plain sentence for a code it does not know, never the code", () => {
    const message = instantEvalFailureMessage({ run: { error: "toString", priceUsd: 0 } });
    expect(message).toBe("This Instant Eval could not finish. Nothing was charged.");
  });
});

describe("failedInstantEvalChip", () => {
  it("finds the chip whose run failed and skips chips without a run", () => {
    const failed = { status: "failed" };
    const found = failedInstantEvalChip({
      chips: [
        { key: "a", runId: null },
        { key: "b", runId: "run-ok" },
        { key: "c", runId: "run-bad" },
      ],
      runs: { "run-ok": { status: "finished" }, "run-bad": failed },
    });
    expect(found?.chip.key).toBe("c");
    expect(found?.run).toBe(failed);
  });
});
