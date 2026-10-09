/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature, billing.feature (enterprise),
 * project-service, organization-service and annotation-service features (modules/<name>/specs)
 */
import { migrationStepsOverMemory } from "@langwatch/process";
import { isMigrationStep, type MigrationStep } from "@langwatch/upgrade/step";
import { beforeAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const USAGE_BILLING_STEP = "billing:record-usage-billing-catch-up";
const SPEND_STEP = "instant-eval:copy-judge-spend";
const PROJECT_CREATED_STEP = "project:record-created-facts";
const PROJECT_FACT_STEPS = [
  PROJECT_CREATED_STEP,
  "project:record-department-assignments",
  "project:record-presence-settings",
];
const ORGANIZATION_PRESENCE_STEP = "organization:record-presence-settings";
const ANNOTATION_TRACE_STEP = "annotation:record-trace-annotations";
const BACKGROUND_AFTER_OLD_WRITERS = {
  kind: "data",
  mode: "background",
  needsOldWritersGone: true,
};

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

    /** @scenario "The project created step runs after the judge spend catch-up" */
    it("declares the project created step after the spend catch-up", () => {
      expect(steps.find((step) => step.id === PROJECT_CREATED_STEP)?.after).toContain(SPEND_STEP);
    });

    /** @scenario "The project fact steps are background steps that wait for old writers to go" */
    it("declares each project fact step as a background data step after old writers", () => {
      for (const id of PROJECT_FACT_STEPS) {
        expect(steps.find((step) => step.id === id)).toMatchObject(BACKGROUND_AFTER_OLD_WRITERS);
      }
    });

    /** @scenario "The organization presence step is a background step that waits for old writers to go" */
    it("declares the organization presence step as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === ORGANIZATION_PRESENCE_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });

    /** @scenario "The annotation trace step is a background step that waits for old writers to go" */
    it("declares the annotation trace step as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === ANNOTATION_TRACE_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });
  });
});
