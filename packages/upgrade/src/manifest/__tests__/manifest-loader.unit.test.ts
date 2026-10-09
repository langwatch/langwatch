import { describe, expect, it } from "vitest";

import { loadReleases, parseManifests } from "../manifest-loader.ts";
import { ManifestLoadError } from "../manifest.ts";

function manifestFile({ name, release, ids }: { name: string; release: string; ids: string[] }) {
  return {
    name,
    text: JSON.stringify({
      release,
      previous: null,
      cutAt: "2026-10-06T12:00:00+02:00",
      steps: ids.map((id) => ({
        id,
        kind: "postgres-schema",
        mode: "blocking",
        owner: null,
        description: "Postgres schema",
      })),
    }),
  };
}

function refusalOf(load: () => unknown): ManifestLoadError {
  try {
    load();
  } catch (error) {
    if (error instanceof ManifestLoadError) return error;
    throw error;
  }
  throw new Error("expected the manifests to be refused");
}

describe("parseManifests()", () => {
  describe("when two manifests name the same Prisma folder", () => {
    /** @scenario "A step id named by two manifests is refused when the manifests load" */
    it("refuses with duplicate_step, naming the id and both releases", () => {
      const refusal = refusalOf(() =>
        parseManifests({
          files: [
            manifestFile({
              name: "3.22.0.json",
              release: "3.22.0",
              ids: ["prisma:20261006000001_a"],
            }),
            manifestFile({
              name: "3.21.0.json",
              release: "3.21.0",
              ids: ["prisma:20261006000001_a"],
            }),
          ],
        }),
      );

      expect(refusal.code).toBe("duplicate_step");
      expect(refusal.message).toContain("prisma:20261006000001_a");
      expect(refusal.message).toContain("3.21.0");
      expect(refusal.message).toContain("3.22.0");
    });
  });

  describe("when a file's name is not its release", () => {
    /** @scenario "A manifest whose file name is not its release is refused" */
    it("refuses with release_mismatch, naming the file", () => {
      const refusal = refusalOf(() =>
        parseManifests({
          files: [manifestFile({ name: "3.21.0.json", release: "3.22.0", ids: [] })],
        }),
      );

      expect(refusal.code).toBe("release_mismatch");
      expect(refusal.message).toContain("3.21.0.json");
    });
  });
});

describe("loadReleases()", () => {
  describe("when the package's shipped releases are read", () => {
    /** @scenario "The shipped manifests chain from the backfill start to the LTS floor" */
    it("names 3.20.1 as the floor and chains every release from 3.19.0 to it", () => {
      const { manifests, floor } = loadReleases();
      const chain = ["3.19.0", "3.19.1", "3.19.2", "3.19.3", "3.19.4", "3.20.0", "3.20.1"];

      expect(floor.release).toBe("3.20.1");
      expect(manifests.map((manifest) => manifest.release).slice(0, chain.length)).toEqual(chain);
      expect(manifests.slice(0, chain.length).map((manifest) => manifest.previous)).toEqual([
        "3.18.1",
        ...chain.slice(0, -1),
      ]);
    });
  });
});
