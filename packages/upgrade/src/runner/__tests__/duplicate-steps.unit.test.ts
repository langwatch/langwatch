/**
 * @vitest-environment node
 * Spec: packages/upgrade/specs/duplicate-steps.feature
 */
import { describe, expect, it } from "vitest";

import type { ManifestStep } from "../../manifest/manifest.ts";
import { duplicateStepFailure, duplicateSteps } from "../duplicate-steps.ts";

const step = (id: string, description: string, release: string | null = null) => ({
  id,
  kind: "clickhouse-schema" as ManifestStep["kind"],
  mode: "blocking" as ManifestStep["mode"],
  owner: null,
  description,
  release,
});

describe("duplicateSteps()", () => {
  describe("when the image's tree ships one goose version from two files", () => {
    /** @scenario "A shipped step list naming one id twice reports the id and both sources" */
    it("reports the step id with both goose files", () => {
      const duplicates = duplicateSteps({
        steps: [
          step("clickhouse:00002", "ClickHouse schema: add", "3.21.0"),
          step("clickhouse:00003", "ClickHouse schema: a"),
          step("clickhouse:00003", "ClickHouse schema: b"),
        ],
        gooseFiles: ["00002_add.sql", "00003_b.sql", "00003_a.sql"],
      });
      expect(duplicates).toEqual([
        { id: "clickhouse:00003", sources: ["00003_a.sql", "00003_b.sql"] },
      ]);
      expect(duplicateStepFailure({ duplicates })).toMatchObject({
        code: "duplicate_step",
        detail: { steps: duplicates },
      });
    });
  });

  describe("when a released goose version gains a second file in the image", () => {
    it("reports the version with both files although the shipped list names it once", () => {
      const duplicates = duplicateSteps({
        steps: [step("clickhouse:00003", "ClickHouse schema: a", "3.21.0")],
        gooseFiles: ["00003_a.sql", "00003_b.sql"],
      });
      expect(duplicates).toEqual([
        { id: "clickhouse:00003", sources: ["00003_a.sql", "00003_b.sql"] },
      ]);
    });
  });

  describe("when a step id repeats without goose files behind it", () => {
    it("names each source by its release and description", () => {
      const duplicates = duplicateSteps({
        steps: [
          step("dataset:copy-keys", "Copies keys", "3.21.0"),
          step("dataset:copy-keys", "Copies keys again"),
        ],
      });
      expect(duplicates).toEqual([
        {
          id: "dataset:copy-keys",
          sources: ["3.21.0 (Copies keys)", "the image's tree (Copies keys again)"],
        },
      ]);
    });
  });

  describe("when every shipped id is distinct", () => {
    it("reports nothing", () => {
      const steps = [step("clickhouse:00002", "a"), step("clickhouse:00003", "b")];
      expect(duplicateSteps({ steps, gooseFiles: ["00002_a.sql", "00003_b.sql"] })).toEqual([]);
    });
  });
});
