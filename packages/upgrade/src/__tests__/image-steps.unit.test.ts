/**
 * @vitest-environment node
 * Spec: modules/ops/specs/upgrades-checkup.feature
 * Spec: specs/upgrade/release-manifests.feature
 */
import { describe, expect, it } from "vitest";

import { duplicateStep, imageSteps } from "../gate/image-tree.ts";

const treeOf = (gooseFiles: string[]) => ({ prismaFolders: [], gooseFiles, codeSteps: [] });
const duplicateIn = (gooseFiles: string[]) =>
  duplicateStep({
    steps: imageSteps({ release: "3.22.0", tree: treeOf(gooseFiles) }),
    gooseFiles,
  });

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
    /** @scenario "Listing the image steps of a tree with a shared prefix does not throw" */
    it("still lists both steps, so the boot path stays up", () => {
      const tree = treeOf(["00125_a.sql", "00125_b.sql"]);

      expect(imageSteps({ release: "3.22.0", tree }).map((step) => step.id)).toEqual([
        "clickhouse:00125",
        "clickhouse:00125",
      ]);
    });
  });

  describe("given no tree", () => {
    it("reads the tree this image ships", () => {
      expect(imageSteps({ release: "3.22.0" }).length).toBeGreaterThan(0);
    });
  });
});

describe("duplicateStep", () => {
  describe("given goose files with distinct prefixes", () => {
    /** @scenario "A step id two goose files share is found with every file behind it" */
    it("finds no shared step id", () => {
      expect(duplicateIn(["00124_x.sql", "00125_y.sql"])).toBeNull();
    });
  });

  describe("given goose files that map to one step id", () => {
    /** @scenario "A step id two goose files share is found with every file behind it" */
    it.each([
      {
        case: "prefixes that pad to the same number",
        files: ["125_a.sql", "00125_b.sql"],
        named: ["125_a.sql", "00125_b.sql"],
      },
      {
        case: "three files on one prefix",
        files: ["00125_a.sql", "00125_b.sql", "00125_c.sql"],
        named: ["00125_a.sql", "00125_b.sql", "00125_c.sql"],
      },
      {
        case: "a file that is not a goose migration beside them",
        files: ["00125_a.sql", "README.md", "00125_b.sql"],
        named: ["00125_a.sql", "00125_b.sql"],
      },
    ])("names clickhouse:00125 and every goose file behind it, given $case", ({ files, named }) => {
      expect(duplicateIn(files)).toMatchObject({ id: "clickhouse:00125", files: named });
    });

    /** @scenario "A step id two goose files share is found with every file behind it" */
    it("says which id and files collide and to renumber the unapplied one", () => {
      expect(duplicateIn(["00125_a.sql", "00125_b.sql"])?.message).toBe(
        "two migrations share step id clickhouse:00125: 00125_a.sql, 00125_b.sql; " +
          "renumber the one that has not been applied yet",
      );
    });
  });
});
