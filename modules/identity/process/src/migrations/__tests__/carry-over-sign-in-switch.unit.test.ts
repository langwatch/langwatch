// Spec: modules/identity/specs/sign-in-switch.feature
import { describe, expect, it } from "vitest";

import { identityStep, stepContext } from "./identity-worker.fixture.ts";

const STEP = "identity:carry-over-sign-in-switch";

describe("identity's sign-in switch carry-over step", () => {
  /** @scenario "The carry-over is a background step that waits for older images to go" */
  it("is a background step that needs old writers gone", async () => {
    const { runtime, step } = await identityStep({ id: STEP });
    try {
      expect(step).toMatchObject({ mode: "background", needsOldWritersGone: true });
    } finally {
      await runtime.stop();
    }
  });

  it("reports nothing copied over an empty store, for a run and a dry run", async () => {
    const { runtime, step } = await identityStep({ id: STEP });
    try {
      expect(await step.run(stepContext({ dryRun: false }))).toEqual({ copied: 0 });
      expect(await step.run(stepContext({ dryRun: true }))).toEqual({ wouldCopy: 0 });
    } finally {
      await runtime.stop();
    }
  });
});
