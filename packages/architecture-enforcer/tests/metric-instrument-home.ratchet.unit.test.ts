/**
 * Spec: specs/tooling/lint-metric-instrument-home.feature.
 * Record: dev/docs/ARCHITECTURE.md §17, the metric-instrument-home shrink-only list (Alex,
 * 2026-10-20).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  collectMetricInstrumentsOutsideHome,
  metricInstrumentHomeKey,
} from "../src/policies/quality/metric-instrument-home.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { compareRatchet, countByKey, readRatchet } from "./ratchet.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");
const LIST = join(here, "baselines", "metric-instrument-home.json");

let snapshot: WorkspaceSnapshot;

beforeAll(() => {
  snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
}, 60_000);

function compared() {
  return compareRatchet({
    current: countByKey(collectMetricInstrumentsOutsideHome(snapshot).map(metricInstrumentHomeKey)),
    listed: readRatchet({ file: LIST }).findings,
  });
}

describe("the metric-instrument-home list", () => {
  describe("when the tree's metric instruments outside a metrics file are counted", () => {
    /** @scenario "No module file gains a metric instrument outside its metrics service" */
    it("finds no file above its listed count", () => {
      expect(
        compared().grown,
        "create the instrument in the module's <subject>-metrics.service.ts and inject it (pnpm --filter @langwatch/architecture-enforcer lint shows each site)",
      ).toEqual([]);
    }, 60_000);

    /** @scenario "A moved instrument lowers the list in the same change" */
    it("finds every listed count still reached", () => {
      expect(
        compared().stale,
        "lower these in tests/baselines/metric-instrument-home.json",
      ).toEqual([]);
    }, 60_000);
  });
});
