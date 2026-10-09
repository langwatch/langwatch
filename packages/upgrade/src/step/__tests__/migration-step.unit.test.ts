/**
 * The step contract a module declares with `.withMigrations`.
 * Spec: packages/process/specs/module-migrations.feature
 */
import { describe, expect, it } from "vitest";

import {
  type MigrationStepDeclarationError,
  type MigrationStepReport,
  defineMigrationStep,
  isMigrationStep,
} from "../index.ts";

const noReport = async (): Promise<MigrationStepReport> => ({});

function refusalOf(define: () => unknown): MigrationStepDeclarationError {
  try {
    define();
  } catch (error) {
    return error as MigrationStepDeclarationError;
  }
  throw new Error("expected the definition to refuse");
}

describe("defineMigrationStep", () => {
  describe("when a step declares a blank description", () => {
    /** @scenario "A migration step declared without a description is refused by name" */
    it("refuses, naming the module and the step", () => {
      const refusal = refusalOf(() =>
        defineMigrationStep({
          id: "evaluation:backfill-scores",
          kind: "data",
          mode: "background",
          description: "  ",
          run: noReport,
        }),
      );

      expect(refusal.code).toBe("migration_step_declaration_refused");
      expect(refusal.refusal).toBe("missing_description");
      expect(refusal.module).toBe("evaluation");
      expect(refusal.step).toBe("evaluation:backfill-scores");
    });
  });

  describe("when a blocking step is not a data step", () => {
    /** @scenario "A blocking migration step whose kind is not data is refused by name" */
    it("refuses, naming the module and the step", () => {
      const refusal = refusalOf(() =>
        defineMigrationStep({
          id: "evaluation:enrol-tenants",
          kind: "tenant",
          mode: "blocking",
          description: "Enrols every organization in the new scorer.",
          run: noReport,
        }),
      );

      expect(refusal.refusal).toBe("blocking_not_data");
      expect(refusal.module).toBe("evaluation");
      expect(refusal.step).toBe("evaluation:enrol-tenants");
    });
  });

  describe("when the id is not a module and a kebab name", () => {
    /** @scenario "A migration step id that is not a module and a kebab name is refused by name" */
    it("refuses, naming the id", () => {
      const refusal = refusalOf(() =>
        defineMigrationStep({
          id: "Evaluation/BackfillScores",
          kind: "data",
          mode: "background",
          description: "Backfills scores.",
          run: noReport,
        }),
      );

      expect(refusal.refusal).toBe("malformed_id");
      expect(refusal.step).toBe("Evaluation/BackfillScores");
    });
  });

  describe("when a background data step runs as a dry run resuming from a checkpoint", () => {
    /** @scenario "A defined step runs with its checkpoint, dry-run flag and signal and returns its report" */
    it("is handed all three and returns its report", async () => {
      const step = defineMigrationStep({
        id: "dataset:copy-keys",
        kind: "data",
        mode: "background",
        description: "Copies each dataset's storage key into the new column.",
        run: async ({ checkpoint, dryRun, signal }) => ({
          resumedAfter: checkpoint.resumeFrom?.lastId ?? null,
          dryRun,
          aborted: signal.aborted,
        }),
      });
      const checkpoint = { resumeFrom: { lastId: "ds_41" }, save: async () => undefined };

      const report = await step.run({
        checkpoint,
        dryRun: true,
        signal: new AbortController().signal,
      });

      expect(report).toEqual({ resumedAfter: "ds_41", dryRun: true, aborted: false });
    });
  });
});

describe("isMigrationStep", () => {
  /** @scenario "The step guard accepts a defined step and nothing else" */
  it("accepts a defined step and rejects a task, a step with no run and a hand-built blocking tenant step", () => {
    const step = defineMigrationStep({
      id: "dataset:copy-keys",
      kind: "data",
      mode: "blocking",
      description: "Copies each dataset's storage key into the new column.",
      run: noReport,
    });
    const { run: _run, ...withoutRun } = step;

    expect(isMigrationStep(step)).toBe(true);
    expect(isMigrationStep({ name: "dataset-backfill", run: noReport })).toBe(false);
    expect(isMigrationStep(withoutRun)).toBe(false);
    expect(isMigrationStep({ ...step, kind: "tenant" })).toBe(false);
  });
});

describe("defineMigrationStep after", () => {
  const copy = defineMigrationStep({
    id: "evaluation:copy-inputs",
    kind: "data",
    mode: "background",
    description: "Copies evaluation inputs.",
    run: noReport,
  });

  describe("when a background step runs after another step value", () => {
    /** @scenario "A step names the steps it runs after by their values and keeps their ids" */
    it("keeps the named step's id", () => {
      const purge = defineMigrationStep({
        id: "evaluation:purge-inputs",
        kind: "data",
        mode: "background",
        description: "Purges copied evaluation inputs.",
        after: [copy],
        run: noReport,
      });

      expect(purge.after).toEqual(["evaluation:copy-inputs"]);
      expect(isMigrationStep(purge)).toBe(true);
    });
  });

  describe("when a step names another module's step by its generated id", () => {
    /** @scenario "A step names another module's step by its generated id" */
    it("keeps the id", () => {
      const spend = defineMigrationStep({
        id: "instant-eval:copy-spend",
        kind: "data",
        mode: "background",
        description: "Copies spend.",
        after: ["billing:record-usage-billing-catch-up"],
        run: noReport,
      });

      expect(spend.after).toEqual(["billing:record-usage-billing-catch-up"]);
    });
  });

  describe("when a step names another by a mistyped id", () => {
    /** @scenario "A step named by a mistyped id fails typecheck" */
    it("fails typecheck; the plan refuses it as an unknown step", () => {
      const purge = defineMigrationStep({
        id: "evaluation:purge-inputs",
        kind: "data",
        mode: "background",
        description: "Purges copied evaluation inputs.",
        // @ts-expect-error a step names a step value or a generated CodeStepId, never a free string
        after: ["evaluation:copy-inptus"],
        run: noReport,
      });

      expect(purge.after).toEqual(["evaluation:copy-inptus"]);
    });
  });

  describe("when a blocking step runs after a background step", () => {
    /** @scenario "Only a background step runs after others, and only after background steps" */
    it("refuses it as after_not_background", () => {
      const refusal = refusalOf(() =>
        defineMigrationStep({
          id: "evaluation:copy-keys",
          kind: "data",
          mode: "blocking",
          description: "Copies keys.",
          after: [copy],
          run: noReport,
        }),
      );
      expect(refusal.refusal).toBe("after_not_background");
    });
  });
});
