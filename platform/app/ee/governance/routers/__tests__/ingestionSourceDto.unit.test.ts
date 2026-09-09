// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What the ingestion-source DTO says about a trace destination.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 *
 * The edit drawer must be able to tell "this destination is archived" from
 * "this destination is a project I cannot see". Both make the id fail to
 * resolve against the picker's list, and only one of them means routing has
 * stopped — so the server decides it and the DTO carries the answer, the
 * same way the virtual-key DTO does (`virtualKey.dto.ts:168-170`).
 *
 * ADR-088 v7, Decision 9.
 */
import { describe, expect, it } from "vitest";
import { toIngestionSourceDto } from "../ingestionSources";

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "src_1",
    organizationId: "org_acme",
    teamId: null,
    sourceType: "databricks_genie",
    name: "Genie fleet",
    description: null,
    parserConfig: {},
    pullSchedule: "0 */6 * * *",
    status: "active",
    traceProjectId: null,
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
    ...overrides,
  }) as Parameters<typeof toIngestionSourceDto>[0]["row"];

describe("a source's latest pull result", () => {
  it("distinguishes provider rate limits from a busy local database", () => {
    const dto = toIngestionSourceDto({
      row: row(),
      liveTraceProjectIds: new Set(),
      pullRun: {
        LastRunAt: 1,
        LastRunOutcome: "failed",
        LastRunError: "Anthropic rate limit exceeded (HTTP 429).",
      },
    });
    expect(dto.pullStatus.error).toBe(
      "The provider's request limit was reached.",
    );
  });
  it("shows a safe failure reason and saved billing progress without exposing provider tokens or error payloads", () => {
    const dto = toIngestionSourceDto({
      row: row({
        sourceType: "anthropic_admin",
        pollerCursor: JSON.stringify({
          startingAt: "2026-01-01T00:00:00Z",
          watermark: "2026-02-01T00:00:00Z",
          page: "private-page-token",
        }),
      }),
      liveTraceProjectIds: new Set(),
      pullRun: {
        LastRunAt: Date.parse("2026-02-02T12:00:00Z"),
        LastRunOutcome: "failed",
        LastRunError: "Too many simultaneous queries; private upstream payload",
      },
    });
    expect(dto.pullStatus).toEqual({
      lastRunAt: "2026-02-02T12:00:00.000Z",
      outcome: "failed",
      error: "The database is busy.",
      backfillThrough: "2026-02-01T00:00:00.000Z",
      hasMore: true,
    });
    expect(JSON.stringify(dto)).not.toContain("private");
  });

  it("does not present an unstarted or unreadable cursor as completed history", () => {
    for (const pollerCursor of [
      null,
      "not-json",
      JSON.stringify({
        startingAt: "2026-01-01T00:00:00Z",
        page: "private",
        watermark: null,
      }),
    ]) {
      const dto = toIngestionSourceDto({
        row: row({ sourceType: "openai_admin", pollerCursor }),
        liveTraceProjectIds: new Set(),
      });
      expect(dto.pullStatus?.backfillThrough).toBeNull();
    }
  });
});

describe("given an ingestion source with a trace destination", () => {
  describe("when the destination is still a live project of this org", () => {
    it("reports it as not archived", () => {
      const dto = toIngestionSourceDto({
        row: row({ traceProjectId: "proj_live" }),
        liveTraceProjectIds: new Set(["proj_live"]),
      });
      expect(dto.traceProjectId).toBe("proj_live");
      expect(dto.traceProjectArchived).toBe(false);
    });
  });

  describe("when the destination is no longer live", () => {
    it("reports it as archived, so the drawer can say routing has stopped", () => {
      const dto = toIngestionSourceDto({
        row: row({ traceProjectId: "proj_gone" }),
        liveTraceProjectIds: new Set<string>(),
      });
      expect(dto.traceProjectId).toBe("proj_gone");
      expect(dto.traceProjectArchived).toBe(true);
    });
  });

  describe("when no destination was ever set", () => {
    it("is not archived, because there is nothing to have been archived", () => {
      const dto = toIngestionSourceDto({
        row: row({ traceProjectId: null }),
        liveTraceProjectIds: new Set<string>(),
      });
      expect(dto.traceProjectArchived).toBe(false);
    });
  });

  describe("when the row carries secrets in its parser config", () => {
    it("keeps stripping them, destination or not", () => {
      const dto = toIngestionSourceDto({
        row: row({
          traceProjectId: "proj_live",
          parserConfig: {
            workspaceUrl: "https://example.databricks.net",
            credentials: "sealed-envelope",
            _rotation: { priorHash: "x" },
          },
        }),
        liveTraceProjectIds: new Set(["proj_live"]),
      });
      expect(dto.parserConfig).toEqual({
        workspaceUrl: "https://example.databricks.net",
      });
    });
  });
});

describe("given a pull source whose cadence lives in two places", () => {
  describe("when the column and the parser config's copy disagree", () => {
    it("sends the column, because that is what the scheduler reads", () => {
      // Without this the edit form cannot see the column at all, and falls
      // back to the adapter's copy inside parserConfig — a duplicate nothing
      // keeps in sync, which the form would then write back over the live
      // value.
      const dto = toIngestionSourceDto({
        row: row({
          sourceType: "anthropic_admin",
          pullSchedule: "0 */6 * * *",
          parserConfig: { adapter: "anthropic_admin", schedule: "0 * * * *" },
        }),
        liveTraceProjectIds: new Set<string>(),
      });

      expect(dto.pullSchedule).toBe("0 */6 * * *");
    });
  });

  describe("when the source does not pull at all", () => {
    it("passes the null through, because null is what stops it running", () => {
      const dto = toIngestionSourceDto({
        row: row({ sourceType: "otel_generic", pullSchedule: null }),
        liveTraceProjectIds: new Set<string>(),
      });

      expect(dto.pullSchedule).toBeNull();
    });
  });

  describe("when the parser config also carries the sealed credential", () => {
    it("still strips it, cadence or no cadence", () => {
      const dto = toIngestionSourceDto({
        row: row({
          sourceType: "anthropic_admin",
          parserConfig: {
            adapter: "anthropic_admin",
            schedule: "0 * * * *",
            credentials: "enc:v1:deadbeef:cafe:0123",
            _rotation: { priorHash: "abc" },
          },
        }),
        liveTraceProjectIds: new Set<string>(),
      });

      expect(dto.parserConfig).not.toHaveProperty("credentials");
      expect(dto.parserConfig).not.toHaveProperty("_rotation");
      expect(JSON.stringify(dto)).not.toContain("enc:v1:");
    });
  });
});
