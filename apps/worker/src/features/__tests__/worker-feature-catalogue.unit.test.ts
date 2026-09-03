/**
 * What `src/features/catalogue.json` declares, and why it needs a test at all.
 *
 * The file shipped listing one feature — `["topic"]` — while sixteen more
 * installers sat beside it on disk. Nothing noticed, because nothing reads it:
 * `packages/architecture-lint` has a catalogue reader for
 * `packages/features/catalogue.json` and another for
 * `apps/ui/src/features/catalogue.json`, and neither looks here. A declaration
 * no tool checks is not a declaration, and a stale one is worse than none —
 * it reads as a complete inventory while naming a sixteenth of the graph.
 *
 * This suite is what makes it true. It compares the catalogue against the
 * installer names the feature sources actually declare, so adding an installer
 * without declaring it fails here rather than passing silently.
 *
 * It also holds `job-registry.json` to the same standard. That file names
 * every routing key on the shared `event-sourcing/jobs` queue, in mount order,
 * against the feature that owns it — the checklist the packaged consumer must
 * satisfy before it may claim the queue. Its keys are compared against the
 * live legacy registry by `worker-pipeline-parity` in `platform/app`, which is
 * the only place both graphs can be built; what belongs here is the half that
 * needs no other package: that the two declarations name the same features.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featuresRoot = resolve(import.meta.dirname, "..");

const catalogue = JSON.parse(readFileSync(join(featuresRoot, "catalogue.json"), "utf8")) as {
  version: number;
  features: string[];
};

const jobRegistry = JSON.parse(readFileSync(join(featuresRoot, "job-registry.json"), "utf8")) as {
  version: number;
  queue: string;
  pipelines: { name: string; feature: string; jobs: string[] }[];
  globalProjections: { pipeline: string; jobs: string[] };
};

/**
 * The installer names as the sources declare them.
 *
 * Read from the files rather than imported, deliberately: `name` is an
 * instance property on a class with a private constructor, so importing would
 * mean composing every feature's dependencies to ask a question about the
 * declaration.
 */
function declaredInstallerNames(): string[] {
  const names: string[] = [];
  for (const feature of readdirSync(featuresRoot, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    const directory = join(featuresRoot, feature.name);
    for (const file of readdirSync(directory)) {
      if (!file.endsWith(".installer.ts")) continue;
      const source = readFileSync(join(directory, file), "utf8");
      const match = /readonly name = "([^"]+)"/.exec(source);
      if (match?.[1]) names.push(match[1]);
    }
  }
  return names;
}

describe("worker feature catalogue", () => {
  describe("given the installers present in the worker package", () => {
    it("declares every one of them", () => {
      expect([...catalogue.features].sort()).toEqual(declaredInstallerNames().sort());
    });

    it("declares each exactly once", () => {
      expect(catalogue.features).toHaveLength(new Set(catalogue.features).size);
    });
  });

  describe("when the catalogue is read", () => {
    it("stays sorted, so membership rather than mount order is what it states", () => {
      // Mount order is `orderedFeatureInstallers` in the production
      // composition and is pinned by its own suite. Repeating it here would
      // be a second copy free to drift from the one the worker executes.
      expect(catalogue.features).toEqual([...catalogue.features].sort());
    });
  });
});

describe("worker job registry", () => {
  describe("given the routing keys the shared queue carries", () => {
    it("attributes every pipeline to a declared feature", () => {
      const owners = [...new Set(jobRegistry.pipelines.map((pipeline) => pipeline.feature))];

      expect(owners.sort()).toEqual([...catalogue.features].sort());
    });

    it("names the one queue every pipeline shares", () => {
      // One queue is the whole reason parity has to be exact: a job whose
      // routing key no handler claims is rejected for redelivery, not dropped.
      expect(jobRegistry.queue).toBe("event-sourcing/jobs");
    });

    it("names each pipeline once, and each of its jobs once", () => {
      const names = jobRegistry.pipelines.map((pipeline) => pipeline.name);

      expect(names).toHaveLength(new Set(names).size);
      for (const pipeline of jobRegistry.pipelines) {
        expect(pipeline.jobs, `${pipeline.name} lists a job twice`).toHaveLength(
          new Set(pipeline.jobs).size,
        );
      }
    });
  });
});
