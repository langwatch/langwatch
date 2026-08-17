import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import DurationManifestReporter, {
  mergeDurations,
} from "../durationManifestReporter";
import { createWeigher, loadDurationManifest } from "../shardWeights";

/** A vitest TestModule, as much of one as the reporter actually reads. */
const fakeModule = (moduleId: string, duration: number) =>
  ({ moduleId, diagnostic: () => ({ duration }) }) as never;

/** Binds specs/ci/shard-duration-weights.feature. */
describe("shard weights", () => {
  let root: string;
  let manifestPath: string;

  const writeFile = (relative: string, contents: string) => {
    writeFileSync(path.join(root, relative), contents);
  };

  const writeManifest = (contents: unknown) => {
    writeFileSync(
      manifestPath,
      typeof contents === "string" ? contents : JSON.stringify(contents),
    );
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "weights-"));
    manifestPath = path.join(root, "vitest.durations.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("given a manifest recording how long files took", () => {
    /** @scenario "A file the manifest knows is weighed by its duration" */
    it("weighs a known file by its recorded duration", () => {
      writeFile("slow.test.ts", "x");
      writeManifest({ "slow.test.ts": 9000 });

      const weigh = createWeigher({
        manifest: loadDurationManifest(manifestPath),
        root,
      });

      expect(weigh(path.join(root, "slow.test.ts"))).toBe(9000);
    });

    /** @scenario "A file added since the last refresh is weighed by its size" */
    it("weighs an unknown file by its size", () => {
      writeFile("known.test.ts", "x".repeat(100));
      writeFile("new.test.ts", "y".repeat(200));
      writeManifest({ "known.test.ts": 1000 });

      const weigh = createWeigher({
        manifest: loadDurationManifest(manifestPath),
        root,
      });

      // The manifest averages 1000ms across 100 bytes, so 200 bytes of unknown
      // file is worth about 2000ms on the same footing.
      expect(weigh(path.join(root, "new.test.ts"))).toBeCloseTo(2000, 5);
    });

    /** @scenario "A file added since the last refresh is comparable to a measured one" */
    it("puts a big unknown file above a small measured one", () => {
      writeFile("quick.test.ts", "x".repeat(10));
      writeFile("huge.test.ts", "y".repeat(5000));
      writeManifest({ "quick.test.ts": 50 });

      const weigh = createWeigher({
        manifest: loadDurationManifest(manifestPath),
        root,
      });

      expect(weigh(path.join(root, "huge.test.ts"))).toBeGreaterThan(
        weigh(path.join(root, "quick.test.ts")),
      );
    });

    /** @scenario "A file that cannot be read still lands in a shard" */
    it("gives an unreadable file a weight rather than dropping it", () => {
      writeFile("known.test.ts", "x".repeat(100));
      writeManifest({ "known.test.ts": 1000 });

      const weigh = createWeigher({
        manifest: loadDurationManifest(manifestPath),
        root,
      });

      expect(weigh(path.join(root, "does-not-exist.test.ts"))).toBeGreaterThan(
        0,
      );
    });
  });

  describe("when the manifest cannot be trusted", () => {
    /** @scenario "There is no manifest" */
    it("loads an empty manifest when there is no file", () => {
      expect(loadDurationManifest(manifestPath)).toEqual({});
    });

    /** @scenario "The manifest is not valid JSON" */
    it("loads an empty manifest from invalid JSON", () => {
      writeManifest("{not json");
      expect(loadDurationManifest(manifestPath)).toEqual({});
    });

    /** @scenario "The manifest is a JSON array" */
    it("loads an empty manifest from a JSON array", () => {
      writeManifest([1, 2, 3]);
      expect(loadDurationManifest(manifestPath)).toEqual({});
    });

    /** @scenario "An unusable duration is discarded rather than used as a weight" */
    it.each([
      ["zero", 0],
      ["a negative number", -5],
      ["a string", "900"],
      ["null", null],
      ["infinity", Number.POSITIVE_INFINITY],
    ])("discards %s", (_label, value) => {
      // Infinity is not representable in JSON and serialises to null, so write
      // the object directly rather than through JSON.stringify.
      writeFileSync(
        manifestPath,
        `{"good.test.ts": 100, "bad.test.ts": ${
          value === Number.POSITIVE_INFINITY ? "1e999" : JSON.stringify(value)
        }}`,
      );

      const manifest = loadDurationManifest(manifestPath);

      expect(manifest["bad.test.ts"]).toBeUndefined();
      expect(manifest["good.test.ts"]).toBe(100);
    });

    /** @scenario "There is no manifest" */
    it("weighs everything by size when nothing is measured", () => {
      writeFile("a.test.ts", "x".repeat(10));
      writeFile("b.test.ts", "y".repeat(20));

      const weigh = createWeigher({ manifest: {}, root });

      expect(weigh(path.join(root, "b.test.ts"))).toBeGreaterThan(
        weigh(path.join(root, "a.test.ts")),
      );
    });
  });

  describe("when a run writes its durations", () => {
    /** @scenario "A shard reports only what it measured" */
    it("writes only the files it measured", () => {
      const deltaPath = path.join(root, "vitest.durations.delta.json");
      const reporter = new DurationManifestReporter({
        manifestPath: deltaPath,
        root,
      });

      reporter.onTestModuleEnd(fakeModule(path.join(root, "a.test.ts"), 120));
      reporter.onTestModuleEnd(fakeModule(path.join(root, "b.test.ts"), 340));
      reporter.onTestRunEnd();

      expect(JSON.parse(readFileSync(deltaPath, "utf8"))).toEqual({
        "a.test.ts": 120,
        "b.test.ts": 340,
      });
    });

    /** @scenario "A shard never writes over the committed manifest" */
    it("leaves the committed manifest untouched", () => {
      writeManifest({ "already-measured.test.ts": 999 });
      const before = readFileSync(manifestPath, "utf8");

      const reporter = new DurationManifestReporter({
        manifestPath: path.join(root, "vitest.durations.delta.json"),
        root,
      });
      reporter.onTestModuleEnd(fakeModule(path.join(root, "a.test.ts"), 120));
      reporter.onTestRunEnd();

      expect(readFileSync(manifestPath, "utf8")).toBe(before);
    });
  });

  describe("when a refresh merges new durations in", () => {
    /** @scenario "A shard refreshes only the files it ran" */
    it("keeps files this run did not execute", () => {
      const merged = mergeDurations({
        existing: { "other-shard.test.ts": 500 },
        measured: { "this-shard.test.ts": 700 },
      });

      expect(merged).toEqual({
        "other-shard.test.ts": 500,
        "this-shard.test.ts": 700,
      });
    });

    /** @scenario "A re-measured file takes its new duration" */
    it("replaces a duration that was measured again", () => {
      const merged = mergeDurations({
        existing: { "a.test.ts": 500 },
        measured: { "a.test.ts": 900 },
      });

      expect(merged["a.test.ts"]).toBe(900);
    });

    /** @scenario "The manifest is written in a stable order" */
    it("lists the files in sorted order", () => {
      const merged = mergeDurations({
        existing: { "z.test.ts": 1, "m.test.ts": 2 },
        measured: { "a.test.ts": 3 },
      });

      expect(Object.keys(merged)).toEqual([
        "a.test.ts",
        "m.test.ts",
        "z.test.ts",
      ]);
    });
  });
});
