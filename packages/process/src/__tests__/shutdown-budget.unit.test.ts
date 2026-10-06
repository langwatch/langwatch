/**
 * @vitest-environment node
 * The shutdown clocks derive from one drain budget; the chart and its suite carry the
 * same numbers as literals, so this reads them rather than restating them.
 * @see specs/background/worker-graceful-shutdown.feature
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { processShutdownDeadlineMs, SHUTDOWN_CLOSE_SLACK_MS } from "../shutdown-deadline.ts";

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

const read = (...segments: string[]) => readFileSync(path.join(REPO_ROOT, ...segments), "utf8");

/** The one capture group of a pattern, as a number; a pattern that misses fails loudly. */
function numberFrom({
  source,
  pattern,
  label,
}: {
  source: string;
  pattern: RegExp;
  label: string;
}) {
  const match = pattern.exec(source);
  if (!match?.[1]) throw new Error(`${label}: no match for ${String(pattern)}`);
  return Number(match[1].replaceAll("_", ""));
}

const helpers = read("charts", "langwatch", "templates", "_helpers.tpl");
const suite = read("charts", "langwatch", "tests", "workers-shutdown.sh");
const values = read("charts", "langwatch", "values.yaml");
const queue = read("packages", "group-queue", "src", "groupQueue.ts");

/** Seconds above the drain at which the chart renders the process deadline. */
const chartDeadlineMarginSeconds = numberFrom({
  source: helpers,
  pattern: /PROCESS_SHUTDOWN_DEADLINE_MS\s*\n\s*value: \{\{ mul \(add \(int \$drain\) (\d+)\)/,
  label: "chart process deadline",
});

/** Seconds above the drain at which the chart grants the kubelet's grace period. */
const chartGraceMarginSeconds = numberFrom({
  source: helpers,
  pattern: /\$required := add \$drain (\d+)/,
  label: "chart required grace",
});

const suiteDrainSeconds = numberFrom({
  source: suite,
  pattern: /readonly DRAIN_SECONDS=(\d+)/,
  label: "chart suite drain",
});
const suiteDeadlineMarginSeconds = numberFrom({
  source: suite,
  pattern: /readonly DEADLINE_MARGIN_SECONDS=(\d+)/,
  label: "chart suite deadline margin",
});
const suiteGraceMarginSeconds = numberFrom({
  source: suite,
  pattern: /readonly REQUIRED_MARGIN_SECONDS=(\d+)/,
  label: "chart suite grace margin",
});

/** The chart's per-component drain and grace: the app block comes first, then workers. */
const componentValues = (["app", "workers"] as const).map((component, index) => {
  const drains = [...values.matchAll(/^ {2}shutdownDrainSeconds: (\d+)$/gm)];
  const graces = [...values.matchAll(/^ {2}terminationGracePeriodSeconds: (\d+)$/gm)];
  return {
    component,
    drainSeconds: Number(drains[index]?.[1]),
    graceSeconds: Number(graces[index]?.[1]),
  };
});

const queueDefaultDrainMs = numberFrom({
  source: queue,
  pattern: /shutdownTimeoutMs: ([\d_]+),/,
  label: "queue default drain",
});

const drainsMs = [1_000, 5_000, 25_000, 120_000];

const deadlineFor = (queueDrainMs: number) =>
  processShutdownDeadlineMs({ deadlineMs: undefined, queueDrainMs });

describe("the shutdown budget", () => {
  describe("given any configured drain budget", () => {
    describe("when the shutdown clocks are derived from it", () => {
      /** @scenario "Every shutdown clock nests inside the one outside it" */
      it.each(drainsMs)("finishes each clock inside the outer one for a %dms drain", (drain) => {
        const deadline = deadlineFor(drain);
        const kubeletGrace = drain + chartGraceMarginSeconds * 1000;

        expect(drain).toBeLessThan(deadline);
        expect(deadline).toBeLessThan(kubeletGrace);
      });
    });
  });

  describe("given an operator raises the drain budget", () => {
    describe("when the shutdown clocks are derived", () => {
      /** @scenario "Raising the drain budget widens every clock above it" */
      it.each([1_000, 35_000, 95_000])("widens the deadline by the same %dms", (increase) => {
        const base = 25_000;
        const graceFor = (drain: number) => drain + chartGraceMarginSeconds * 1000;

        expect(deadlineFor(base + increase) - deadlineFor(base)).toBe(increase);
        expect(graceFor(base + increase) - graceFor(base)).toBe(increase);
      });
    });
  });

  describe("given the derived shutdown budget", () => {
    describe("when it is compared with the margin the chart and its suite apply", () => {
      /** @scenario "The required grace period matches what the chart guard enforces" */
      it("agrees on the deadline margin and the grace margin in all three places", () => {
        expect(SHUTDOWN_CLOSE_SLACK_MS).toBe(chartDeadlineMarginSeconds * 1000);
        expect(chartDeadlineMarginSeconds).toBe(suiteDeadlineMarginSeconds);
        expect(chartGraceMarginSeconds).toBe(suiteGraceMarginSeconds);
        expect(chartGraceMarginSeconds * 1000).toBeGreaterThan(SHUTDOWN_CLOSE_SLACK_MS);
      });
    });
  });

  describe("given the resolved production drain budget", () => {
    describe("when it is compared with the drain the chart and its suite declare", () => {
      /** @scenario "The chart is sized for the same production drain the code uses" */
      it.each(componentValues)(
        "sizes the $component pod for the queue's default drain",
        ({ drainSeconds, graceSeconds }) => {
          expect(drainSeconds * 1000).toBe(queueDefaultDrainMs);
          expect(drainSeconds).toBe(suiteDrainSeconds);
          expect(graceSeconds).toBe(drainSeconds + chartGraceMarginSeconds);
          expect(deadlineFor(queueDefaultDrainMs)).toBe(
            (drainSeconds + chartDeadlineMarginSeconds) * 1000,
          );
        },
      );
    });
  });
});
