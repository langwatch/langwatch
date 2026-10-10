/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import type { UpgradeImage } from "../reader.schema.ts";
import { createUpgradeReader } from "../reader.service.ts";

/** A database holding no ledger tables: every row the reader lists is one the image declares. */
const readerOf = ({ image }: { image: UpgradeImage }) =>
  createUpgradeReader({ postgres: { query: async () => ({ rows: [] }) }, image, floor: null });

const steps: UpgradeImage["steps"] = [
  { id: "prisma:2", kind: "postgres-schema", mode: "blocking", release: null },
  { id: "prisma:1", kind: "postgres-schema", mode: "blocking", release: "3.20.1" },
];

describe("listReleases", () => {
  describe("when the image is unreleased", () => {
    /** @scenario "An unreleased image marks the Unreleased row as this image" */
    it("marks the Unreleased row as this image and lists the unlisted step there", async () => {
      const { items } = await readerOf({ image: { release: "unreleased", steps } }).listReleases();
      const summaries = items.map(({ release, image, stepCount }) => ({
        release,
        image,
        stepCount,
      }));
      expect(summaries).toHaveLength(2);
      expect(summaries).toContainEqual({ release: null, image: true, stepCount: 1 });
      expect(summaries).toContainEqual({ release: "3.20.1", image: false, stepCount: 1 });
    });
  });

  describe("when the image is a release", () => {
    it("marks that release as this image", async () => {
      const { items } = await readerOf({ image: { release: "3.20.1", steps } }).listReleases();
      expect(items.find((item) => item.image)?.release).toBe("3.20.1");
    });
  });
});
