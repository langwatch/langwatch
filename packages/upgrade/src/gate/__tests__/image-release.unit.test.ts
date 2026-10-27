/**
 * An image is the newest stamped release only when it ships nothing beyond the stamped steps.
 * Specs: specs/upgrade/release-manifests.feature, packages/upgrade/specs/release-baseline.feature.
 */
import { describe, expect, it } from "vitest";

import { loadReleaseBaseline } from "../../manifest/baseline.ts";
import { loadReleases } from "../../manifest/manifest-loader.ts";
import { gooseStepId, prismaStepId, stampRelease } from "../../manifest/stamp.ts";
import { readImageCodeSteps } from "../image-code-steps.ts";
import { imageRelease, readImageTree, unstampedSteps } from "../image-tree.ts";

const stamped = {
  prismaFolders: ["20260101000000_first"],
  gooseFiles: ["00001_first.sql"],
  codeSteps: [],
};
const baseline = { release: "3.18.1", steps: [] };
const manifests = [
  stampRelease({
    release: "3.20.1",
    previous: null,
    cutAt: "2026-01-01T00:00:00Z",
    current: stamped,
    shipped: new Set(),
    ownerOf: () => null,
  }),
];

describe("imageRelease()", () => {
  describe("when the image ships only stamped steps", () => {
    /** @scenario "An image shipping only stamped steps names itself the newest release" */
    it("names the newest stamped release", () => {
      expect(imageRelease({ manifests, tree: stamped, baseline })).toBe("3.20.1");
    });
  });

  describe("when the image ships a step no manifest lists", () => {
    /** @scenario "An image shipping a step beyond the stamped ones names itself unreleased" */
    it("names itself unreleased", () => {
      const tree = { ...stamped, prismaFolders: [...stamped.prismaFolders, "20261010000000_next"] };
      expect(imageRelease({ manifests, tree, baseline })).toBeNull();
    });
  });
});

describe("imageRelease() over the release baseline", () => {
  const real = { ...loadReleases(), baseline: loadReleaseBaseline() };
  const tree = readImageTree({ codeSteps: readImageCodeSteps() });
  const sqlIds = new Set([
    ...tree.prismaFolders.map((folder) => prismaStepId({ folder })),
    ...tree.gooseFiles.flatMap((file) => gooseStepId({ file }) ?? []),
  ]);
  const stampedIds = new Set([
    ...real.baseline.steps,
    ...real.manifests.flatMap((manifest) => manifest.steps.map(({ id }) => id)),
  ]);
  const baselineTree = {
    prismaFolders: tree.prismaFolders.filter((folder) =>
      real.baseline.steps.includes(prismaStepId({ folder })),
    ),
    gooseFiles: tree.gooseFiles.filter((file) =>
      real.baseline.steps.includes(gooseStepId({ file }) ?? ""),
    ),
    codeSteps: [],
  };

  describe("when the baseline is read beside the manifests", () => {
    /** @scenario "The baseline holds every step shipped at the first manifest's previous release" */
    it("names the first manifest's previous release and no step a manifest names", () => {
      expect(real.baseline.release).toBe(real.manifests[0]?.previous);
      const named = new Set(
        real.manifests.flatMap((manifest) => manifest.steps.map(({ id }) => id)),
      );
      expect(real.baseline.steps.filter((id) => named.has(id))).toEqual([]);
      expect(real.baseline.steps.length).toBeGreaterThan(400);
    });
  });

  describe("when this image's own tree is checked", () => {
    /** @scenario "On this image's tree only steps newer than every stamped step are unstamped" */
    it("leaves only Prisma folders and goose files newer than every stamped one unstamped", () => {
      const unstamped = unstampedSteps({
        manifests: real.manifests,
        tree,
        baseline: real.baseline,
      });
      const unstampedSql = unstamped.filter((id) => sqlIds.has(id));
      expect(unstampedSql.filter((id) => real.baseline.steps.includes(id))).toEqual([]);
      expect(unstampedSql.length).toBeLessThan(sqlIds.size / 4);
      for (const kind of ["prisma:", "clickhouse:"]) {
        const newestStamped = [...stampedIds]
          .filter((id) => id.startsWith(kind))
          .toSorted()
          .at(-1);
        for (const id of unstampedSql.filter((each) => each.startsWith(kind))) {
          expect(id > (newestStamped ?? "")).toBe(true);
        }
      }
    });
  });

  describe("when a tree ships only steps the baseline holds and no manifest", () => {
    /** @scenario "An image shipping only steps from the baseline names the baseline's release" */
    it("names the baseline's release", () => {
      expect(baselineTree.prismaFolders.length).toBeGreaterThan(300);
      expect(imageRelease({ manifests: [], tree: baselineTree, baseline: real.baseline })).toBe(
        "3.18.1",
      );
    });
  });
});
