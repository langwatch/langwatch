/**
 * A scheduled report reads its traces with the platform's own-only proof: no person asks,
 * so automation asks AuthzApi.authorizeInternal as itself (ruling TRACE-PROOF-REPORTS).
 */
import { sealAuthorization } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { TraceApi, TraceListPage } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ReportTraceListService } from "../../features/report/services/report-trace-list.service.ts";

const PROJECT_ID = "project-1";
const READER = { type: "internal", codePath: "automation.report-trace-list" } as const;
const PROOF = sealAuthorization({
  actor: READER,
  principal: READER,
  scope: { organizationId: "organization-1" },
  grants: [{ projectId: PROJECT_ID, permissions: ["traces:view"], via: [], kind: "own" }],
  expiresAt: Date.now() + 5 * 60 * 1000,
  purpose: { kind: "operator", entry: "ReportTraceListService.list" },
});
const EMPTY_PAGE: TraceListPage = { items: [], totalHits: 0, nextCursor: null };

describe("given a scheduled report with a trace query", () => {
  describe("when its trace list is read", () => {
    it("reads with the platform's own-only traces:view proof for the report's project", async () => {
      const authorizeInternal = vi.fn<AuthzApi["authorizeInternal"]>(async () => PROOF);
      const readTraceList = vi.fn<TraceApi["readTraceList"]>(async () => EMPTY_PAGE);
      const translateTraceFilter = vi.fn<TraceApi["translateTraceFilter"]>(() => null);
      const service = ReportTraceListService.create({
        traces: { readTraceList, translateTraceFilter },
        authz: { authorizeInternal },
        baseHost: "https://app.example",
      });

      await service.list({
        projectId: PROJECT_ID,
        projectSlug: "project-slug",
        query: "status:error",
        from: 0,
        to: 1000,
        limit: 5,
      });

      expect(authorizeInternal).toHaveBeenCalledWith({
        actor: READER,
        projectId: PROJECT_ID,
        permission: "traces:view",
        purpose: { kind: "operator", entry: "ReportTraceListService.list" },
      });
      expect(readTraceList).toHaveBeenCalledWith(
        expect.objectContaining({ authorization: PROOF, pageSize: 5 }),
      );
      expect(translateTraceFilter).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PROJECT_ID }),
      );
    });
  });
});
