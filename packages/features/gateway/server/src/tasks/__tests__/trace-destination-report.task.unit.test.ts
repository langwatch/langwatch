import { describe, expect, it } from "vitest";
import {
  GatewayTraceDestinationReportRepository,
  type TraceDestinationKeyRow,
  type TraceDestinationProjectRow,
} from "../../repositories/gateway-trace-destination-report.repository";
import { reportTraceDestinationBackfill } from "../trace-destination-report.task";

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

class FakeRepository extends GatewayTraceDestinationReportRepository {
  constructor(
    private readonly rows: {
      projects: TraceDestinationProjectRow[];
      keys: TraceDestinationKeyRow[];
      organizations: Array<{ id: string }>;
    },
  ) {
    super();
  }

  async findProjects(): Promise<TraceDestinationProjectRow[]> {
    return this.rows.projects;
  }

  /** The second page is empty, which is what ends the keyset walk. */
  async findKeyPage({ after }: { after: string | null }): Promise<TraceDestinationKeyRow[]> {
    return after === null ? this.rows.keys : [];
  }

  async findOrganizationIds(): Promise<string[]> {
    return this.rows.organizations.map((organization) => organization.id);
  }
}

function fakeRepository({
  projects,
  keys,
  organizations = [{ id: "org-1" }],
}: {
  projects: TraceDestinationProjectRow[];
  keys: TraceDestinationKeyRow[];
  organizations?: Array<{ id: string }>;
}): GatewayTraceDestinationReportRepository {
  return new FakeRepository({ projects, keys, organizations });
}

describe("reportTraceDestinationBackfill", () => {
  describe("given keys naming live, archived and foreign projects", () => {
    /** @scenario "The trace-destination report classifies every key by the rule that would answer for it" */
    it("classifies each under the rule that would answer for it", async () => {
      const repository = fakeRepository({
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

      const report = await reportTraceDestinationBackfill({ repository });

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
      const repository = fakeRepository({
        projects: [project({ id: "live" })],
        keys: [key({ id: "vk-bare" })],
        organizations: [{ id: "org-1" }, { id: "org-empty" }],
      });

      const report = await reportTraceDestinationBackfill({ repository });

      expect(report.counts.null).toBe(1);
      expect(report.organizationsWithoutGovernanceProject).toBe(2);
      expect(report.organizationsWithDestinationlessKeys).toEqual(["org-1"]);
    });
  });
});
