/**
 * @vitest-environment node
 * A failed presence probe is a server-written statement: reported as built in, no hash.
 * @see specs/lwql/query-origin.feature
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { DASHBOARD_SOURCES } from "@langwatch/dashboard-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { SourcePresenceService } from "../source-presence.service.ts";

describe("given every source presence statement fails", () => {
  /** @scenario "A built-in failure outside the workbench carries no hash" */
  it("reports each failure as built in for the project and still answers failed", async () => {
    const failure = new Error("Code: 47");
    const reportBuiltInQueryFailure = vi.fn();
    const analytics = createApiFixture<AnalyticsApi>({
      resolveRunCaller: async () => ({ project: { id: "project-1" } }) as never,
      executeLangWatchQL: async () => {
        throw failure;
      },
      reportBuiltInQueryFailure,
    });

    const presence = await SourcePresenceService.create({ analytics }).getPresence({
      projectId: "project-1",
      userId: "member-1",
    });

    expect(Object.values(presence)).toEqual(DASHBOARD_SOURCES.map(() => "failed"));
    expect(reportBuiltInQueryFailure).toHaveBeenCalledTimes(DASHBOARD_SOURCES.length);
    for (const source of DASHBOARD_SOURCES) {
      expect(reportBuiltInQueryFailure).toHaveBeenCalledWith({
        projectId: "project-1",
        source,
        error: failure,
      });
    }
  });
});
