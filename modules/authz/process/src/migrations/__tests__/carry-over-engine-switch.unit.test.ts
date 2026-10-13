// Spec: modules/authz/specs/engine-switch.feature
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { isDeclaredMigrationStep, isMigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { authzProcessModule } from "../../authz.module.ts";

const STEP = "authz:carry-over-engine-switch";

async function stepOnFreshAuthz() {
  const runtime = await createApp({ role: "worker" })
    .withModules([authzProcessModule])
    .withConfig({
      authz: {
        epochCacheEnabled: false,
        demoProjectId: undefined,
        demoProjectUserId: undefined,
        demoProjectSlug: undefined,
      },
    })
    .withStores(memoryStores())
    .withEventing(
      new EventSourcing({ enabled: false, processStore: InMemoryProcessStore.createForTesting() }),
    )
    .provide({})
    .boot();
  const step = runtime
    .migrationSteps(isDeclaredMigrationStep)
    .filter(isMigrationStep)
    .find((candidate) => candidate.id === STEP);
  if (!step) throw new Error(`step ${STEP} is not declared`);
  return { runtime, step };
}

describe("authz's engine switch carry-over step", () => {
  /** @scenario "The carry-over is a background step that waits for older images to go" */
  it("is a background step that needs old writers gone and copies nothing from memory", async () => {
    const { runtime, step } = await stepOnFreshAuthz();
    const context = {
      checkpoint: { resumeFrom: null, save: async () => undefined },
      signal: new AbortController().signal,
    };
    try {
      expect(step).toMatchObject({ mode: "background", needsOldWritersGone: true });
      expect(await step.run({ ...context, dryRun: false })).toEqual({ copied: 0 });
      expect(await step.run({ ...context, dryRun: true })).toEqual({ wouldCopy: 0 });
    } finally {
      await runtime.stop();
    }
  });
});
