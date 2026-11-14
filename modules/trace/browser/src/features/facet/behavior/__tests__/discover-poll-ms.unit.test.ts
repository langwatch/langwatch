/**
 * @vitest-environment node
 * A viewer answered pending asks again every few seconds, and stops once the
 * facets land or a read fails.
 * @see specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { discoverPollMs } from "../use-trace-facets.ts";

describe("discoverPollMs", () => {
  /** @scenario "A viewer answered pending asks again until the facets land" */
  it("asks again every few seconds while the answer is pending", () => {
    const ms = discoverPollMs({ status: "success", data: { pending: true } });

    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(10_000);
  });

  /** @scenario "A viewer answered pending asks again until the facets land" */
  it("stops once the facets have landed", () => {
    expect(discoverPollMs({ status: "success", data: { pending: false } })).toBe(false);
  });

  /** @scenario "A viewer answered pending asks again until the facets land" */
  it("stops when a read fails, though its last answer still says pending", () => {
    expect(discoverPollMs({ status: "error", data: { pending: true } })).toBe(false);
  });
});
