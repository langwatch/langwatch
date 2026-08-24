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
    status: "active",
    traceProjectId: null,
    lastEventAt: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdById: null,
    ...overrides,
  }) as Parameters<typeof toIngestionSourceDto>[0]["row"];

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
