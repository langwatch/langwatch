/**
 * The checked-in charts bundle is what the frame runs; it must match a fresh build of its source.
 * Regenerate with `node dev/scripts/build-charts-lib.mjs`.
 * @see specs/analytics/custom-chart-sandbox-imports.feature
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildChartsLibScript } from "../../../chart-frame-charts-lib-source.ts";

const GENERATOR = fileURLToPath(
  new URL("../../../../../../../dev/scripts/build-charts-lib.mjs", import.meta.url),
);

describe("the bundled charts library", () => {
  /** @scenario "The bundled charts library matches a fresh build of its source" */
  it("matches a fresh build of its source", () => {
    const fresh = execFileSync(process.execPath, [GENERATOR, "--print"], { encoding: "utf8" });

    expect(buildChartsLibScript()).toBe(fresh);
  });
});
