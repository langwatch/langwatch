/**
 * The analytics fold writes the metadata keys the stock widgets read as columns of its row.
 * @see specs/lwql/stock-widgets-read-no-map.feature
 * @see specs/lwql/release-check-reads-releases.feature
 */
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { traceAnalyticsAppVersion } from "../../rules/app-version.rules.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
} from "../trace-derived.projection.ts";
import { createTestRuntime } from "./trace-summary-test.fixtures.ts";

const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

function rowOf(attributes: Record<string, string>) {
  const state: TraceAnalyticsData = { ...projection.init(), traceId: "trace-metadata", attributes };
  return TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
    state,
    tenantId: "tenant-metadata",
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function columnsOf(attributes: Record<string, string>) {
  const { metadataColumns } = rowOf(attributes);
  if (!metadataColumns) throw new Error("the fold's row carries no metadata columns");
  return metadataColumns;
}

describe("TraceAnalyticsFoldProjection metadata columns", () => {
  describe("given a trace that sent the widgets' metadata keys", () => {
    /** @scenario "The trace fold writes the metadata keys the stock widgets read" */
    it("writes each key's value to its column, as the trimmed map holds it", () => {
      const columns = columnsOf({
        "metadata.outcome": "resolved",
        "metadata.outcome_reason": "answered",
        "metadata.prompt_version": "v7",
        "metadata.environment": "production",
        "metadata.topic": "billing",
        "metadata.sent_to_review": "true",
      });

      expect(columns).toMatchObject({
        MetadataOutcome: "resolved",
        MetadataOutcomeReason: "answered",
        MetadataPromptVersion: "v7",
        MetadataEnvironment: "production",
        MetadataTopic: "billing",
        MetadataSentToReview: "true",
        MetadataTeam: "",
      });
    });
  });

  describe("given a trace that names its environment only as metadata.env", () => {
    /** @scenario "The trace fold reads metadata.env when metadata.environment is absent" */
    it("writes metadata.env to MetadataEnvironment", () => {
      expect(columnsOf({ "metadata.env": "staging" }).MetadataEnvironment).toBe("staging");
      expect(
        columnsOf({ "metadata.environment": "", "metadata.env": "staging" }).MetadataEnvironment,
      ).toBe("staging");
    });

    it("prefers metadata.environment when the trace sent both", () => {
      expect(
        columnsOf({ "metadata.environment": "production", "metadata.env": "staging" })
          .MetadataEnvironment,
      ).toBe("production");
    });
  });

  describe("given a trace that names its application version", () => {
    const versionOf = (attributes: Record<string, string>) =>
      traceAnalyticsAppVersion(rowOf(attributes).attributes);

    /** @scenario "The trace fold reads the version where an application puts it" */
    it("writes service.version, else metadata.version, else metadata.app_version", () => {
      expect(versionOf({ "service.version": "v14.1" })).toBe("v14.1");
      expect(versionOf({ "metadata.version": "v14" })).toBe("v14");
      expect(versionOf({ "metadata.app_version": "2.3.0" })).toBe("2.3.0");
      expect(versionOf({ "service.version": "v14.1", "metadata.version": "v13.2" })).toBe("v14.1");
      expect(versionOf({ "service.name": "support-agent" })).toBe("");
    });
  });

  describe("given a trace that sent none of them", () => {
    it("writes an empty string to every metadata column", () => {
      expect(Object.values(columnsOf({})).every((value) => value === "")).toBe(true);
    });
  });
});
