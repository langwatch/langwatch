// Spec: modules/identity/specs/provider-token-discard.feature
import { describe, expect, it } from "vitest";

import { identityStep, stepContext } from "./identity-worker.fixture.ts";

const STEP = "identity:discard-provider-tokens";

describe("identity's provider token discard step", () => {
  /** @scenario "The credential token discard is a background step after auth's" */
  it("is a background step that needs old writers gone and runs after auth's", async () => {
    const { runtime, step } = await identityStep({ id: STEP });
    try {
      expect(step).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
        after: ["auth:discard-provider-tokens"],
      });
    } finally {
      await runtime.stop();
    }
  });

  it("reports what it cleared on a run and what it would clear on a dry run", async () => {
    const { runtime, step } = await identityStep({ id: STEP });
    try {
      expect(await step.run(stepContext({ dryRun: false }))).toEqual({ cleared: 0 });
      expect(await step.run(stepContext({ dryRun: true }))).toEqual({ wouldClear: 0 });
    } finally {
      await runtime.stop();
    }
  });
});
