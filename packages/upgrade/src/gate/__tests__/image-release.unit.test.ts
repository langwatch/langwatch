/**
 * An image is the newest stamped release only when it ships nothing beyond the stamped steps.
 * Specs: specs/upgrade/release-manifests.feature, packages/upgrade/specs/release-baseline.feature.
 */
import { describe, expect, it } from "vitest";

import { loadReleaseBaseline } from "../../manifest/baseline.ts";
import { loadReleases } from "../../manifest/manifest-loader.ts";
import { gooseStepId, prismaStepId, stampRelease } from "../../manifest/stamp.ts";
import { readImageCodeSteps } from "../image-code-steps.ts";
import {
  imageRelease,
  readImageTree,
  releaseIdentityRefusal,
  STAMP_RELEASE_COMMAND,
  stampTreeRelease,
  unstampedSteps,
} from "../image-tree.ts";

const codeStep = {
  id: "dataset:move-content-to-object-storage",
  kind: "data",
  mode: "background",
  owner: "dataset",
  description: "Moves dataset content to object storage",
} as const;
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

describe("releaseIdentityRefusal()", () => {
  describe("when the tree's every step is in a manifest up to its release", () => {
    /** @scenario "A release tree whose manifest is stamped names itself that release" */
    it("refuses nothing", () => {
      expect(
        releaseIdentityRefusal({ release: "3.20.1", manifests, tree: stamped, baseline }),
      ).toBeNull();
    });
  });

  describe("when the release has no manifest", () => {
    /** @scenario "A release tree without its manifest fails the release check" */
    it("refuses with manifest_missing, naming the file and the stamp command", () => {
      const refusal = releaseIdentityRefusal({
        release: "3.21.0",
        manifests,
        tree: stamped,
        baseline,
      });

      expect(refusal?.code).toBe("manifest_missing");
      expect(refusal?.message).toContain("packages/upgrade/releases/3.21.0.json");
      expect(refusal?.message).toContain(STAMP_RELEASE_COMMAND);
    });
  });

  describe("when the manifest misses a code step the tree ships", () => {
    /** @scenario "A release tree shipping a step its manifest misses fails the release check" */
    it("refuses with steps_unstamped, naming the step", () => {
      const tree = { ...stamped, codeSteps: [codeStep] };
      const refusal = releaseIdentityRefusal({ release: "3.20.1", manifests, tree, baseline });

      expect(refusal?.code).toBe("steps_unstamped");
      expect(refusal?.message).toContain(codeStep.id);
    });
  });

  describe("when the tree carries a manifest newer than its release", () => {
    /** @scenario "A release tree carrying a newer release's manifest fails the release check" */
    it("refuses with release_mismatch, naming the newer release", () => {
      const newer = stampRelease({
        release: "3.21.0",
        previous: "3.20.1",
        cutAt: "2026-02-01T00:00:00Z",
        current: { ...stamped, codeSteps: [codeStep] },
        shipped: new Set(manifests.flatMap((manifest) => manifest.steps.map(({ id }) => id))),
        ownerOf: () => null,
      });
      const refusal = releaseIdentityRefusal({
        release: "3.20.1",
        manifests: [...manifests, newer],
        tree: { ...stamped, codeSteps: [codeStep] },
        baseline,
      });

      expect(refusal?.code).toBe("release_mismatch");
      expect(refusal?.message).toContain("3.21.0");
    });
  });
});

describe("stampTreeRelease()", () => {
  const next = {
    previous: "3.20.1",
    cutAt: "2026-02-01T00:00:00Z",
    baseline,
    ownerOf: () => null,
  };

  describe("when the tree adds a Prisma folder and a code step", () => {
    /** @scenario "A release is stamped with every step of its tree no manifest names, code steps included" */
    it("stamps both, and the tree names itself the release", () => {
      const tree = {
        ...stamped,
        prismaFolders: [...stamped.prismaFolders, "20260201000000_next"],
        codeSteps: [codeStep],
      };
      const { manifest, refusal } = stampTreeRelease({
        ...next,
        release: "3.21.0",
        tree,
        earlier: manifests,
      });
      const withIt = manifest ? [...manifests, manifest] : manifests;

      expect(refusal).toBeNull();
      expect(manifest?.steps.map(({ id }) => id)).toEqual([
        "prisma:20260201000000_next",
        codeStep.id,
      ]);
      expect(imageRelease({ manifests: withIt, tree, baseline })).toBe("3.21.0");
    });
  });

  describe("when the release before went out without its manifest", () => {
    /** @scenario "A release after one cut without its manifest also carries that release's steps" */
    it("stamps the earlier release's steps into this one", () => {
      const tree = {
        ...stamped,
        prismaFolders: [...stamped.prismaFolders, "20260201000000_lost", "20260301000000_next"],
      };
      const { manifest } = stampTreeRelease({
        ...next,
        previous: "3.21.0",
        release: "3.22.0",
        tree,
        earlier: manifests,
      });

      expect(manifest?.steps.map(({ id }) => id)).toEqual([
        "prisma:20260201000000_lost",
        "prisma:20260301000000_next",
      ]);
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
