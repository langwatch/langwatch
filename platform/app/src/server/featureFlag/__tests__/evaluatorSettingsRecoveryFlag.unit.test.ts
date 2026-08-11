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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  describe("when the production pipeline is composed", () => {
    // The scope and default above are properties of the REGISTRY ENTRY. They
    // stayed green while the flag was inert in production, because nothing
    // passed `isSettingsRecoveryDisabled` into ExecuteEvaluationCommand and the
    // command defaults an absent resolver to "not disabled" — /ops would have
    // shown the switch as available while flipping it changed nothing.
    //
    // Limit, stated plainly: this reads the composition root's source, so it
    // proves the dependency is WIRED, not that the flag flips behaviour. The
    // behaviour half is owned by executeEvaluation.settings-resolution.unit.test.ts,
    // which drives the resolver true/false/rejecting. Neither test alone is
    // sufficient; this one exists because the wire is what actually broke.
    const registry = readFileSync(
      resolve(__dirname, "../../event-sourcing/pipelineRegistry.ts"),
      "utf-8",
    );

    it("passes the flag resolver into the evaluation command", () => {
      const construction = registry.slice(
        registry.indexOf("new ExecuteEvaluationCommand({"),
      );
      expect(construction).toContain("isSettingsRecoveryDisabled:");
      expect(construction.slice(0, construction.indexOf("});"))).toContain(KEY);
    });
  });
});
