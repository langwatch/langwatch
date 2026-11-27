/**
 * @vitest-environment node
 * Spec: modules/instant-eval/specs/instant-eval-judge-model.feature, billing.feature (enterprise),
 * project-service, organization-service and annotation-service features (modules/<name>/specs)
 */
import { migrationStepsOverMemory } from "@langwatch/process";
import {
  isDeclaredMigrationStep,
  type MigrationStep,
  QUEUE_TENANT_CLAIMS_FILL_STEP,
  type TenantMigrationStep,
} from "@langwatch/upgrade/step";
import { beforeAll, describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

const USAGE_BILLING_STEP = "billing:record-usage-billing-catch-up";
const SPEND_STEP = "instant-eval:copy-judge-spend";
const PROJECT_CREATED_STEP = "project:record-created-facts";
const PROJECT_FACT_STEPS = [PROJECT_CREATED_STEP];
const PROJECT_HISTORY_STEP = "project:list-personal-owner-and-first-message-facts";
const ORGANIZATION_PRESENCE_STEP = "organization:record-presence-settings";
const ORGANIZATION_MEMBER_LISTING_STEP = "organization:list-member-facts";
const ANNOTATION_TRACE_STEP = "annotation:record-trace-annotations";
const REPLAY_STEPS = ["nurturing:replay-virtual-keys", "governance:replay-cost-charges"];
const BACKGROUND_AFTER_OLD_WRITERS = {
  kind: "data",
  mode: "background",
  needsOldWritersGone: true,
};

describe("given the worker's installed modules", () => {
  let steps: readonly (MigrationStep | TenantMigrationStep)[] = [];

  beforeAll(async () => {
    steps = await migrationStepsOverMemory({
      name: "catch-up-step-order",
      modules: processModules,
      environment: {
        NODE_ENV: "production",
        BASE_HOST: "http://langwatch.invalid",
        API_KEY_PEPPER: "catch-up-step-order",
      },
      isMigrationStep: isDeclaredMigrationStep,
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
      expect(afterOf(PROJECT_CREATED_STEP)).toContain(SPEND_STEP);
    });

    /** @scenario "The project facts step is a background step that waits for old writers to go" */
    it("declares the project facts step as a background data step after old writers", () => {
      for (const id of PROJECT_FACT_STEPS) {
        expect(steps.find((step) => step.id === id)).toMatchObject(BACKGROUND_AFTER_OLD_WRITERS);
      }
    });

    /** @scenario "The project history listing is a background step that waits for old writers to go" */
    it("declares the project history listing as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === PROJECT_HISTORY_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });

    /** @scenario "The organization presence step is a background step that waits for old writers to go" */
    it("declares the organization presence step as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === ORGANIZATION_PRESENCE_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });

    /** @scenario "The organization member listing step is a background step that waits for old writers to go" */
    it("declares the organization member listing as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === ORGANIZATION_MEMBER_LISTING_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });

    /** @scenario "The annotation trace step is a background step that waits for old writers to go" */
    it("declares the annotation trace step as a background data step after old writers", () => {
      expect(steps.find((step) => step.id === ANNOTATION_TRACE_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
    });

    /** @scenario "Every projection replay step a worker installs runs after the claimed-groups fill" */
    it("declares the claimed-groups fill after old writers, before every projection replay", () => {
      expect(steps.find((step) => step.id === QUEUE_TENANT_CLAIMS_FILL_STEP)).toMatchObject(
        BACKGROUND_AFTER_OLD_WRITERS,
      );
      for (const id of REPLAY_STEPS) expect(afterOf(id)).toContain(QUEUE_TENANT_CLAIMS_FILL_STEP);
    });
  });

  function afterOf(id: string): readonly string[] | undefined {
    const step = steps.find((candidate) => candidate.id === id);
    return step && "after" in step ? step.after : undefined;
  }
});
