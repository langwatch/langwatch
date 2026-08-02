/**
 * @vitest-environment node
 *
 * AC0c2 for langwatch#6397 — the rollback flag's SCOPE is load-bearing, and
 * nothing else in the tree protects it.
 *
 * `PRODUCT` scope resolves env -> PostHog -> postgres -> default. A
 * PRODUCT-scoped flag with a 0%-rollout PostHog definition would leave the
 * registry default reading "recovery enabled" — so every acceptance test passes
 * — while production still ran the old behaviour and the customer still scored 0
 * on every trace. `SYSTEM` resolves env -> postgres -> default and never
 * consults PostHog.
 */

import { describe, expect, it } from "vitest";
import { FEATURE_FLAGS } from "../registry";

const KEY = "ops_evaluator_settings_recovery_disabled";

describe("the evaluator settings-recovery rollback flag", () => {
  const definition = FEATURE_FLAGS.find((flag) => flag.key === KEY);

  it("is registered", () => {
    expect(definition).toBeDefined();
  });

  it("is SYSTEM scope, so PostHog can never decide it", () => {
    expect(definition?.scope).toBe("SYSTEM");
    expect(definition?.scope).not.toBe("PRODUCT");
  });

  it("ships with the recovery ACTIVE", () => {
    // The key is `..._disabled`, so a false default means the recovery is on.
    expect(definition?.defaultValue).toBe(false);
  });
});
