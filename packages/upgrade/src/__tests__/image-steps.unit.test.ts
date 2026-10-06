/**
 * @vitest-environment node
 * Spec: modules/ops/specs/upgrades-checkup.feature
 */
import { describe, expect, it } from "vitest";

import { imageSteps } from "../image-steps.ts";

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

  describe("given no tree", () => {
    it("reads the tree this image ships", () => {
      expect(imageSteps({ release: "3.22.0" }).length).toBeGreaterThan(0);
    });
  });
});
