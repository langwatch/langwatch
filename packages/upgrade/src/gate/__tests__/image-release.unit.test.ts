/**
 * An image is the newest stamped release only when it ships nothing beyond the stamped steps.
 * Spec: specs/upgrade/release-manifests.feature.
 */
import { describe, expect, it } from "vitest";

import { stampRelease } from "../../manifest/stamp.ts";
import { imageRelease } from "../image-tree.ts";

const stamped = {
  prismaFolders: ["20260101000000_first"],
  gooseFiles: ["00001_first.sql"],
  codeSteps: [],
};
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
      expect(imageRelease({ manifests, tree: stamped })).toBe("3.20.1");
    });
  });

  describe("when the image ships a step no manifest lists", () => {
    /** @scenario "An image shipping a step beyond the stamped ones names itself unreleased" */
    it("names itself unreleased", () => {
      const tree = { ...stamped, prismaFolders: [...stamped.prismaFolders, "20261010000000_next"] };
      expect(imageRelease({ manifests, tree })).toBeNull();
    });
  });
});
