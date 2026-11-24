/**
 * A failed LangWatchQL run's log line: the level its fault earns, and the projects it names.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */
import {
  ClickHouseUnavailableError,
  QueryMemoryExceededError,
  QueryTimeoutError,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import {
  langWatchQLFailureLevel,
  langWatchQLRunProjectIds,
  langWatchQLTelemetryFields,
} from "../langwatch-ql-run-telemetry.rules.ts";

const QUERY_HASH_KEY = new Uint8Array(32);

describe("langWatchQLFailureLevel", () => {
  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("warns for a customer's refusal, such as a query over its memory limit", () => {
    expect(langWatchQLFailureLevel(new QueryMemoryExceededError())).toBe("warn");
  });

  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("errors for a platform fault: a timeout or an unavailable database", () => {
    expect(langWatchQLFailureLevel(new QueryTimeoutError(30_000))).toBe("error");
    expect(langWatchQLFailureLevel(new ClickHouseUnavailableError())).toBe("error");
  });

  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("errors for a throw no module handled, and keeps a cancelled run at info", () => {
    expect(langWatchQLFailureLevel(new TypeError("Cannot read properties of undefined"))).toBe(
      "error",
    );
    expect(langWatchQLFailureLevel(new DOMException("The run was cancelled", "AbortError"))).toBe(
      "info",
    );
  });
});

describe("langWatchQLRunProjectIds", () => {
  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("names the projects a run came from, then those it named, each once", () => {
    expect(
      langWatchQLRunProjectIds({
        own: ["project-1", undefined],
        named: ["project-2", "project-1"],
      }),
    ).toEqual(["project-1", "project-2"]);
  });

  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("names no project for all, or an empty id", () => {
    expect(langWatchQLRunProjectIds({ own: ["project-1"], named: "all" })).toEqual(["project-1"]);
    expect(langWatchQLRunProjectIds({ own: [""] })).toEqual([]);
  });
});

describe("langWatchQLTelemetryFields", () => {
  /** @scenario "Telemetry: a failed query is logged at its fault's level with the projects it ran over" */
  it("names the first project on its own, and lists them all", () => {
    const fields = langWatchQLTelemetryFields({
      telemetry: { caller: "dashboard_widget", dashboardId: "dashboard-1", widgetId: "widget-1" },
      sql: "SELECT 1",
      queryHashKey: QUERY_HASH_KEY,
      projectIds: ["project-1", "project-2"],
    });

    expect(fields).toMatchObject({
      caller: "dashboard_widget",
      projectId: "project-1",
      projectIds: ["project-1", "project-2"],
      dashboardId: "dashboard-1",
      widgetId: "widget-1",
    });
    expect(JSON.stringify(fields)).not.toContain("SELECT");
  });

  /** @scenario "Telemetry: the query log line says who ran it and how it ended" */
  it("carries no project field when the run names no project", () => {
    const fields = langWatchQLTelemetryFields({
      telemetry: { caller: "workbench" },
      sql: "SELECT 1",
      queryHashKey: QUERY_HASH_KEY,
    });

    expect(fields).not.toHaveProperty("projectId");
    expect(fields).not.toHaveProperty("projectIds");
  });
});
