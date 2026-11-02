import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadReleaseBaseline } from "../baseline.ts";
import { loadReleases, parseManifests } from "../manifest-loader.ts";
import { ManifestLoadError } from "../manifest.ts";
import { releaseManifestGaps } from "../stamp.ts";

const CHANGELOG = fileURLToPath(new URL("../../../../../CHANGELOG.md", import.meta.url));

/** The platform releases the root changelog names. */
function changelogReleases(): string[] {
  const headings = readFileSync(CHANGELOG, "utf8").matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm);
  return [...headings].map((match) => match[1] ?? "");
}

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
    /** @scenario "The shipped manifests chain from the backfill start" */
    it("chains every release from 3.19.0 to 3.20.1", () => {
      const { manifests } = loadReleases();
      const chain = ["3.19.0", "3.19.1", "3.19.2", "3.19.3", "3.19.4", "3.20.0", "3.20.1"];

      expect(manifests.map((manifest) => manifest.release).slice(0, chain.length)).toEqual(chain);
      expect(manifests.slice(0, chain.length).map((manifest) => manifest.previous)).toEqual([
        "3.18.1",
        ...chain.slice(0, -1),
      ]);
    });
  });
});

describe("the shipped manifests against the changelog", () => {
  describe("when every release after the baseline is looked up", () => {
    /** @scenario "Every release in the changelog after the baseline has a manifest" */
    it("finds a manifest for each, following the release before it", () => {
      const { manifests } = loadReleases();

      expect(
        releaseManifestGaps({
          released: changelogReleases(),
          baseline: loadReleaseBaseline().release,
          manifests,
        }),
      ).toEqual([]);
    });
  });
});

describe("releaseManifestGaps()", () => {
  const manifest = (release: string, previous: string) => ({ release, previous });

  describe("when a shipped release has no manifest", () => {
    /** @scenario "Every release in the changelog after the baseline has a manifest" */
    it("names it, the release before it, and the command that stamps it", () => {
      const gaps = releaseManifestGaps({
        released: ["3.22.0", "3.18.1", "3.21.0", "3.20.1"],
        baseline: "3.18.1",
        manifests: [manifest("3.20.1", "3.18.1"), manifest("3.22.0", "3.21.0")],
      });

      expect(gaps.map(({ release, previous }) => ({ release, previous }))).toEqual([
        { release: "3.21.0", previous: "3.20.1" },
      ]);
      const stamp =
        "git fetch -q origin 'refs/tags/langwatch@v*:refs/tags/langwatch@v*' && " +
        'pnpm --filter @langwatch/architecture-enforcer print:table-owners --out "$PWD/table-owners.json"' +
        " && node --disable-warning=ExperimentalWarning --experimental-transform-types" +
        " packages/upgrade/scripts/stamp-release.ts --release 3.21.0 --previous 3.20.1" +
        " --table-owners table-owners.json";
      expect(gaps[0]?.stamp).toBe(stamp);
      expect(gaps[0]?.stampShipped).toBe(`${stamp} --tree langwatch@v3.21.0`);
    });
  });

  describe("when a manifest follows the wrong release", () => {
    /** @scenario "Every release in the changelog after the baseline has a manifest" */
    it("names it as a gap", () => {
      const gaps = releaseManifestGaps({
        released: ["3.20.1", "3.21.0"],
        baseline: "3.18.1",
        manifests: [manifest("3.20.1", "3.18.1"), manifest("3.21.0", "3.19.0")],
      });

      expect(gaps.map(({ release }) => release)).toEqual(["3.21.0"]);
    });
  });
});
