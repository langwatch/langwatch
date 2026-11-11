/**
 * @vitest-environment node
 * Spec: modules/ops/specs/upgrades-checkup.feature
 */
import { describe, expect, it } from "vitest";

import { assertUniqueStepIds, imageSteps } from "../gate/image-tree.ts";

describe("imageSteps", () => {
  describe("given a tree of one Prisma folder and one goose file", () => {
    /** @scenario "A step the image ships that the ledger has not recorded keeps its migrations row refused, naming the step" */
    it("declares one step per file", () => {
      const steps = imageSteps({
        release: "3.22.0",
        tree: {
          prismaFolders: ["20260101000000_add_thing"],
          gooseFiles: ["00042_add_column.sql"],
          codeSteps: [],
        },
      });
      expect(steps.map((step) => step.id)).toEqual([
        "prisma:20260101000000_add_thing",
        "clickhouse:00042",
      ]);
    });
  });

  describe("given two goose files sharing a numeric prefix", () => {
    const tree = {
      prismaFolders: [],
      gooseFiles: ["00125_a.sql", "00125_b.sql"],
      codeSteps: [],
    };

    /** @scenario "Two goose files sharing a numeric prefix are refused before the upgrade registers steps" */
    it("refuses with duplicate_step before any step reaches the ledger", () => {
      expect(() => assertUniqueStepIds({ tree })).toThrow(
        expect.objectContaining({ code: "duplicate_step" }),
      );
    });

    /** @scenario "Listing the image steps of a tree with a shared prefix does not throw" */
    it("still lists the steps, so the boot path stays up", () => {
      expect(() => imageSteps({ release: "3.22.0", tree })).not.toThrow();
    });
  });

  describe("given no tree", () => {
    it("reads the tree this image ships", () => {
      expect(imageSteps({ release: "3.22.0" }).length).toBeGreaterThan(0);
    });
  });
});
