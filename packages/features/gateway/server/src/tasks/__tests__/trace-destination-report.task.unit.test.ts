import { describe, expect, it, vi } from "vitest";
import {
  reportTraceDestinationBackfill,
  type TraceDestinationKeyRow,
  type TraceDestinationProjectRow,
  type TraceDestinationReportDatabase,
} from "../trace-destination-report.task";

function project(overrides: Partial<TraceDestinationProjectRow>): TraceDestinationProjectRow {
  return {
    id: "project-1",
    kind: "application",
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    team: { organizationId: "org-1" },
    ...overrides,
  } as TraceDestinationProjectRow;
}

function key(overrides: Partial<TraceDestinationKeyRow>): TraceDestinationKeyRow {
  return {
    id: "vk-1",
    organizationId: "org-1",
    traceProjectId: null,
    scopes: [],
    ...overrides,
  } as TraceDestinationKeyRow;
}

function fakeDatabase({
  projects,
  keys,
  organizations = [{ id: "org-1" }],
}: {
  projects: TraceDestinationProjectRow[];
  keys: TraceDestinationKeyRow[];
  organizations?: Array<{ id: string }>;
}): TraceDestinationReportDatabase {
  // The picked delegates return branded `PrismaPromise` values, so the double
  // is built untyped and cast once at the seam. The second page is empty,
  // which is what ends the keyset walk.
  return {
    project: { findMany: vi.fn(async () => projects) },
    organization: { findMany: vi.fn(async () => organizations) },
    virtualKey: {
      findMany: vi.fn(async ({ where }: { where?: { id: { gt: string } } }) => (where ? [] : keys)),
    },
  } as unknown as TraceDestinationReportDatabase;
}

describe("reportTraceDestinationBackfill", () => {
  describe("given keys naming live, archived and foreign projects", () => {
    /** @scenario "The trace-destination report classifies every key by the rule that would answer for it" */
    it("classifies each under the rule that would answer for it", async () => {
      const database = fakeDatabase({
        projects: [
          project({ id: "live" }),
          project({ id: "archived", archivedAt: new Date("2026-01-01") }),
          project({ id: "governance", kind: "internal_governance" }),
          project({ id: "other-org", team: { organizationId: "org-2" } }),
        ],
        keys: [
          key({ id: "vk-live", traceProjectId: "live" }),
          key({ id: "vk-archived", traceProjectId: "archived" }),
          key({ id: "vk-foreign", traceProjectId: "other-org" }),
          key({ id: "vk-scoped", scopes: [{ scopeType: "PROJECT", scopeId: "live" }] }),
          key({ id: "vk-bare" }),
        ],
      });

      const report = await reportTraceDestinationBackfill({ database });

      expect(report.total).toBe(5);
      expect(report.counts).toEqual({
        "explicit-live": 1,
        "explicit-archived": 1,
        "explicit-missing": 1,
        "single-scope": 1,
        governance: 1,
        null: 0,
      });
      expect(report.organizationsWithDestinationlessKeys).toEqual([]);
    });
  });

  describe("when an organization has no live governance project", () => {
    /** @scenario "The trace-destination report names the organizations that gate the migration" */
    it("counts its keys as destinationless and names the organization", async () => {
      const database = fakeDatabase({
        projects: [project({ id: "live" })],
        keys: [key({ id: "vk-bare" })],
        organizations: [{ id: "org-1" }, { id: "org-empty" }],
      });

      const report = await reportTraceDestinationBackfill({ database });

      expect(report.counts.null).toBe(1);
      expect(report.organizationsWithoutGovernanceProject).toBe(2);
      expect(report.organizationsWithDestinationlessKeys).toEqual(["org-1"]);
    });
  });
});
