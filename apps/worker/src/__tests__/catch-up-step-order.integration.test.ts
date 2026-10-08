/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature
 * Spec: enterprise/modules/billing/specs/billing.feature
 */
import { migrationStepsOverMemory } from "@langwatch/process";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import { beforeAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const USAGE_BILLING_STEP = "billing:record-usage-billing-catch-up";
const SPEND_STEP = "instant-eval:copy-judge-spend";

describe("given the worker's installed modules", () => {
  let steps: readonly MigrationStep[] = [];

  beforeAll(async () => {
    steps = await migrationStepsOverMemory({
      name: "catch-up-step-order",
      modules: processModules,
      environment: {
        NODE_ENV: "production",
        BASE_HOST: "http://langwatch.invalid",
        API_KEY_PEPPER: "catch-up-step-order",
      },
      isMigrationStep,
    });
  });

  describe("when they list their upgrade steps", () => {
    /** @scenario "The usage-billing catch-up step is declared before the spend catch-up step" */
    it("declares the usage-billing catch-up before the spend catch-up", () => {
      const ids = steps.map((step) => step.id);

      expect(ids.indexOf(USAGE_BILLING_STEP)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(USAGE_BILLING_STEP)).toBeLessThan(ids.indexOf(SPEND_STEP));
    });

    /** @scenario "The usage-billing catch-up is a background step that waits for old writers to go" */
    it("declares the usage-billing catch-up as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === USAGE_BILLING_STEP)).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
    });

    /** @scenario "The spend catch-up is a background step that waits for old writers to go" */
    it("declares the spend catch-up as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === SPEND_STEP)).toMatchObject({
        kind: "data",
        mode: "background",
        needsOldWritersGone: true,
      });
    });
  });
});
