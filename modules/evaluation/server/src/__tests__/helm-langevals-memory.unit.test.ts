/**
 * @vitest-environment node
 *
 * Worker-pool and memory sizing checks for the evaluations service across every
 * shipped install profile.
 *
 * These are file-content assertions against the real chart values on disk, in
 * the same spirit as stored-objects/__tests__/helm-and-docs-shape.unit.test.ts.
 * The values files ARE the artifact here — what a profile asks for is a fact
 * about its text, not about a render — so reading them is the direct check,
 * not a proxy for one.
 *
 * What this file deliberately does NOT cover is the worker count the chart
 * computes. That is arithmetic over a Kubernetes CPU quantity, and asserting
 * that the template mentions `ceil` would pass just as happily if it said
 * `floor`. It is verified by rendering instead, in
 * charts/langwatch/tests/langevals-sizing.sh, which the chart CI runs on every
 * change under charts/.
 *
 * The figures come from the published images running on a real cluster. See
 * specs/setup/helm-langevals-memory.feature for the measurement table and for
 * why the pool size is the thing that actually governs the footprint.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The repo root that holds `charts/`. Walked up to from this file rather than
// counted with `..` from `process.cwd()`, which was right for exactly one
// package directory and silently wrong the moment the suite moved.
const REPO_ROOT = (() => {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(directory, "charts", "langwatch"))) {
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error("could not find the repository root holding charts/langwatch");
    }
    directory = parent;
  }
  return directory;
})();

/** Resting footprint once the evaluator stack is imported: 543 MiB measured. */
const RESTING_MIB = 543;

/**
 * One worker with every local model resident: 2571 MiB measured. This is the
 * figure a ceiling has to clear, and it only stays the relevant figure because
 * the chart pins the pool size — left alone the service scales it with the
 * node's core count and the footprint becomes a multiple of this.
 */
const SINGLE_WORKER_LOADED_MIB = 2571;

/**
 * Every shipped profile that sizes the evaluations service down from the chart
 * default. The default itself is asserted separately.
 */
const SMALL_PROFILES = [
  "charts/langwatch/examples/values-local.yaml",
  "charts/langwatch/examples/values-test.yaml",
  "charts/langwatch/examples/overlays/size-dev.yaml",
  "charts/langwatch/examples/overlays/size-minimal.yaml",
];

const CHART_DEFAULTS = "charts/langwatch/values.yaml";
const MEBIBYTES: Record<string, number> = { Mi: 1, Gi: 1024, M: 1, G: 1024 };

const SIZING_DOC = "docs/self-hosting/configuration/sizing-and-scaling.mdx";

/**
 * The sizing page quotes each profile's figures so someone can decide how much
 * cluster to buy without reading YAML. A quote is a copy, and copies rot: these
 * numbers had drifted far enough that the page understated a dev install by
 * more than a gigabyte. Each entry pairs a heading on that page with the file
 * it claims to describe.
 */
const DOCUMENTED_PROFILES = [
  {
    heading: "### Development (`size-dev.yaml`)",
    values: "charts/langwatch/examples/overlays/size-dev.yaml",
  },
  {
    heading: "### Production (`size-prod.yaml`)",
    values: "charts/langwatch/examples/overlays/size-prod.yaml",
  },
  {
    heading: "### High Availability (`size-ha.yaml`)",
    values: "charts/langwatch/examples/overlays/size-ha.yaml",
  },
] as const;

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function toMebibytes(quantity: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(Mi|Gi|M|G)$/.exec(quantity.trim());
  if (!match) {
    throw new Error(`Unparseable memory quantity: ${quantity}`);
  }
  return Number(match[1]) * MEBIBYTES[match[2]!]!;
}

/**
 * Pulls the memory request and limit out of a values file's `langevals:` block.
 * Scoped to that block so a neighbouring service's numbers can never be read by
 * mistake: the scan stops at the next top-level key.
 */
function langevalsMemory(relativePath: string): {
  request: number;
  limit: number;
} {
  const contents = readRepoFile(relativePath);
  const block = /^langevals:\n((?:[ \t#].*\n|\n)*)/m.exec(contents);
  if (!block) {
    throw new Error(`No langevals block in ${relativePath}`);
  }

  const read = (key: "requests" | "limits"): number => {
    const line = new RegExp(`^\\s+${key}:.*memory:\\s*([^,}\\s]+)`, "m").exec(block[1]!);
    if (!line) {
      throw new Error(`No ${key}.memory for langevals in ${relativePath}`);
    }
    return toMebibytes(line[1]!);
  };

  return { request: read("requests"), limit: read("limits") };
}

/**
 * The memory figures the sizing page quotes for the evaluations service under
 * one heading, written there as `<request>/<limit> memory`. Scoped to the
 * section so another profile's bullet cannot satisfy the assertion.
 */
function documentedLangevalsMemory(heading: string): {
  request: number;
  limit: number;
} {
  const doc = readRepoFile(SIZING_DOC);
  const start = doc.indexOf(heading);
  if (start === -1) {
    throw new Error(`No "${heading}" section in ${SIZING_DOC}`);
  }
  const after = doc.slice(start + heading.length);
  const end = after.indexOf("\n### ");
  const section = end === -1 ? after : after.slice(0, end);

  const bullet = /^- LangEvals:.*?(\S+)\/(\S+) memory/m.exec(section);
  if (!bullet) {
    throw new Error(`No LangEvals memory bullet under "${heading}"`);
  }

  return {
    request: toMebibytes(bullet[1]!),
    limit: toMebibytes(bullet[2]!),
  };
}

describe("Helm sizing for the evaluations service", () => {
  describe("when a profile configures the evaluations service", () => {
    /** @scenario "No shipped profile claims a worker bound it does not have" */
    it("never leans on WEB_CONCURRENCY, which this server ignores", () => {
      // The server passes an explicit worker count to gunicorn, overriding the
      // environment default, so WEB_CONCURRENCY silently does nothing. Any
      // profile still setting it is claiming a bound it does not have.
      for (const profile of [...SMALL_PROFILES, CHART_DEFAULTS]) {
        expect(readRepoFile(profile)).not.toMatch(/name:\s*WEB_CONCURRENCY/);
      }
    });
  });

  describe("when a profile sizes the evaluations service down", () => {
    /** @scenario "A small install can boot the evaluations service" */
    it.each(SMALL_PROFILES)("boots under the ceiling %s sets", (profile) => {
      const { limit } = langevalsMemory(profile);

      expect(limit).toBeGreaterThan(RESTING_MIB);
    });

    /** @scenario "Running a local-model evaluator does not kill the evaluations service" */
    it.each(SMALL_PROFILES)(
      "survives a local-model evaluator under the ceiling %s sets",
      (profile) => {
        const { limit } = langevalsMemory(profile);

        expect(limit).toBeGreaterThanOrEqual(SINGLE_WORKER_LOADED_MIB);
      },
    );

    /** @scenario "The evaluations service asks for at least what it uses at rest" */
    it.each(SMALL_PROFILES)("requests at least the resting footprint in %s", (profile) => {
      const { request } = langevalsMemory(profile);

      expect(request).toBeGreaterThanOrEqual(RESTING_MIB);
    });

    /** @scenario "Shrinking the footprint shrinks the reservation, not the ceiling" */
    it.each(SMALL_PROFILES)(
      "keeps %s schedulable on a small node by requesting well under its ceiling",
      (profile) => {
        const { request, limit } = langevalsMemory(profile);

        // The point of these profiles is a small scheduling footprint. Holding
        // the request to a fraction of the ceiling is what makes the pod fit on
        // a node it could never fill.
        expect(request).toBeLessThanOrEqual(limit / 2);
      },
    );
  });

  describe("when the sizing page quotes a profile's figures", () => {
    /** @scenario "The sizing documentation quotes the profile it is describing" */
    it.each(DOCUMENTED_PROFILES)("matches $values under $heading", ({ heading, values }) => {
      expect(documentedLangevalsMemory(heading)).toEqual(langevalsMemory(values));
    });
  });

  describe("when no profile is layered on top", () => {
    /** @scenario "A default install covers every worker its CPU allowance buys" */
    it("ships a default ceiling covering every worker its CPU allowance buys", () => {
      const { request, limit } = langevalsMemory(CHART_DEFAULTS);

      // The default allows two cores, so two workers, each able to hold every
      // local model.
      expect(request).toBeGreaterThanOrEqual(RESTING_MIB);
      expect(limit).toBeGreaterThanOrEqual(2 * SINGLE_WORKER_LOADED_MIB);
    });
  });
});
