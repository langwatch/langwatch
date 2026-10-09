import type { Authorization } from "@langwatch/authorization";
/**
 * The sidebar's facet read on the real `TraceModule`: no `query` is the tenant's cached
 * discovery; a `query`, empty included, counts every facet under it in the list's window.
 */
import { ownProjectIdOf } from "@langwatch/authorization/tenant-fence";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { TracesListReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const PROJECT_ID = "project-1";
const TIME_RANGE = { from: 1_000, to: 2_000, live: true };
const FACET = {
  key: "status",
  kind: "categorical" as const,
  label: "Status",
  group: "trace" as const,
  topValues: [{ value: "error", count: 4 }],
  totalDistinct: 1,
};

function harness() {
  const getDiscover = vi.fn<TracesListReader["getDiscover"]>(async () => ({
    facets: [FACET],
    pending: true,
  }));
  const getFacets = vi.fn<TracesListReader["getFacets"]>(async () => [FACET]);
  const app = createTraceAppHarness({
    traces: { list: createApiFixture<TracesListReader>({ getDiscover, getFacets }, "list") },
  });
  return { app, getDiscover, getFacets };
}

/** The project the proof a reader was handed fences its read to. */
function projectFencedBy({ read }: { read: { authorization: Authorization } | undefined }) {
  return read && ownProjectIdOf({ authorization: read.authorization, reads: "traces" });
}

describe("TraceModule.readDiscoverForQuery", () => {
  describe("given no query", () => {
    it("serves the tenant's cached discovery, pending flag and all", async () => {
      const { app, getDiscover, getFacets } = harness();

      await expect(
        app.readDiscoverForQuery({ projectId: PROJECT_ID, timeRange: TIME_RANGE }),
      ).resolves.toEqual({ facets: [FACET], pending: true });
      expect(getDiscover).toHaveBeenCalledWith({
        authorization: expect.anything(),
        timeRange: TIME_RANGE,
      });
      expect(projectFencedBy({ read: getDiscover.mock.lastCall?.[0] })).toBe(PROJECT_ID);
      expect(getFacets).not.toHaveBeenCalled();
    });
  });

  describe("given an empty query the sidebar asked to count under", () => {
    it("counts rather than serving the cached discovery", async () => {
      const { app, getDiscover, getFacets } = harness();

      await expect(
        app.readDiscoverForQuery({ projectId: PROJECT_ID, timeRange: TIME_RANGE, query: "" }),
      ).resolves.toEqual({ facets: [FACET], pending: false });
      expect(getFacets).toHaveBeenCalledWith(expect.objectContaining({ timeRange: TIME_RANGE }));
      expect(projectFencedBy({ read: getFacets.mock.lastCall?.[0] })).toBe(PROJECT_ID);
      expect(getDiscover).not.toHaveBeenCalled();
    });
  });

  describe("given an active query", () => {
    /** @scenario "Facet counts are cached only per query and window" */
    it("counts under it, in the window the list reads, uncached", async () => {
      const { app, getDiscover, getFacets } = harness();

      await expect(
        app.readDiscoverForQuery({
          projectId: PROJECT_ID,
          timeRange: TIME_RANGE,
          query: "status:error",
        }),
      ).resolves.toEqual({ facets: [FACET], pending: false });
      expect(getFacets).toHaveBeenCalledWith(expect.objectContaining({ timeRange: TIME_RANGE }));
      expect(projectFencedBy({ read: getFacets.mock.lastCall?.[0] })).toBe(PROJECT_ID);
      expect(getDiscover).not.toHaveBeenCalled();
    });
  });
});
