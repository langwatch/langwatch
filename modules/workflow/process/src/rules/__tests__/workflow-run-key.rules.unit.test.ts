/**
 * How much life a workflow dispatch's key must still have: more than the dispatch can last.
 *
 * @see modules/workflow/specs/workflow-service.feature
 */
import { RUN_KEY_LIFETIME_MS } from "@langwatch/api-key-contract";
import { describe, expect, it } from "vitest";

import { LAMBDA_INVOCATION_TIMEOUT_SECONDS } from "../nlp-lambda-config.rules.ts";
import { LAMBDA_DISPATCH_KEY_MARGIN_MS, dispatchKeyFloorMs } from "../workflow-run-key.rules.ts";

describe("dispatchKeyFloorMs", () => {
  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("covers a Lambda invocation's whole timeout plus a minute", () => {
    expect(dispatchKeyFloorMs({ onLambda: true })).toBe(
      LAMBDA_INVOCATION_TIMEOUT_SECONDS * 1000 + LAMBDA_DISPATCH_KEY_MARGIN_MS,
    );
    expect(dispatchKeyFloorMs({ onLambda: true })).toBe(960_000);
  });

  /** @scenario "A dispatch never holds a key that lapses before the dispatch can end" */
  it("asks a self-hosted engine's dispatch for a full fresh lifetime", () => {
    expect(dispatchKeyFloorMs({ onLambda: false })).toBe(RUN_KEY_LIFETIME_MS);
  });
});
