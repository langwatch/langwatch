import type {
  AuditLogApi,
  RecordAuditLogCommand,
  RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import {
  ADMIN_WORKSPACE_VIEW_DEDUP_MS,
  type RecordWorkspaceViewInput,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { GovernanceOcsfEventWriter } from "../../repositories/governance.repositories.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../../services/admin-workspace-view-audit.service.ts";
import { auditAggregateRead } from "../aggregate-read-audit.subscriber.ts";

/** Rows carry the time they were written; the window asks for any since `sinceMs`. */
class MemoryAuditLog implements Pick<AuditLogApi, "record" | "hasRecordedSince"> {
  rows: (RecordAuditLogCommand & { id: string; occurredAt: number })[] = [];
  constructor(private readonly clock: () => number) {}

  hasRecordedSince = async (input: RecordedSinceInput): Promise<boolean> =>
    this.rows.some(
      (row) =>
        row.userId === input.userId &&
        row.action === input.action &&
        row.targetKind === input.targetKind &&
        row.targetId === input.targetId &&
        row.occurredAt >= input.sinceMs,
    );

  record = async (command: RecordAuditLogCommand) => {
    const row = { ...command, id: `audit_${this.rows.length + 1}`, occurredAt: this.clock() };
    this.rows.push(row);
    return { id: row.id, occurredAt: row.occurredAt };
  };
}

const ORG = "org_acme";
const aggregate = { id: "project_company", name: "Company view", kind: PROJECT_KIND.AGGREGATE };
const projects = new Map([
  [aggregate.id, { ...aggregate, team: { organizationId: ORG } }],
  [
    "project_plain",
    { id: "project_plain", name: "Plain", kind: "application", team: { organizationId: ORG } },
  ],
  [
    "project_foreign",
    { ...aggregate, id: "project_foreign", team: { organizationId: "org_other" } },
  ],
]);

let nowMs: number;
let auditLog: MemoryAuditLog;
let ocsf: { insertEvent: Mock<GovernanceOcsfEventWriter["insertEvent"]> };
let service: DefaultGovernanceAdminWorkspaceViewAuditService;

beforeEach(() => {
  nowMs = 1_700_000_000_000;
  auditLog = new MemoryAuditLog(() => nowMs);
  ocsf = { insertEvent: vi.fn<GovernanceOcsfEventWriter["insertEvent"]>(async () => undefined) };
  service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
    auditLog,
    teams: createApiFixture<OrganizationApi>({}, "OrganizationApi"),
    targets: { findWithTeam: async (id: string) => projects.get(id) ?? null },
    projects: {
      ensureInternal: async () => ({
        id: "governance-project",
        name: "Governance (internal)",
        slug: "governance-org",
        teamId: "team",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        archivedAtMs: null,
        traceSharingEnabled: false,
      }),
    },
    events: ocsf satisfies GovernanceOcsfEventWriter,
    clock: () => nowMs,
  });
});

const read = (targetProjectId = aggregate.id): RecordWorkspaceViewInput => ({
  actorUserId: "user_admin",
  organizationId: ORG,
  kind: "aggregate",
  targetProjectId,
});

describe("DefaultGovernanceAdminWorkspaceViewAuditService, aggregate kind", () => {
  describe("when an admin reads an aggregate of their organisation", () => {
    it("writes one row of kind aggregate naming the aggregate and nothing else", async () => {
      const result = await service.recordView(read());

      expect(result).toEqual({ recorded: true, auditLogId: "audit_1" });
      expect(auditLog.rows).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          targetKind: "aggregate_project",
          targetId: aggregate.id,
          metadata: { kind: "aggregate", workspaceLabel: aggregate.name },
        }),
      ]);
      expect(ocsf.insertEvent).toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: aggregate.id, sourceType: "aggregate_project" }),
      );
    });
  });

  describe("when the same admin reads it again inside the window", () => {
    it("writes no second row", async () => {
      await service.recordView(read());
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS - 1_000;

      await expect(service.recordView(read())).resolves.toEqual({
        recorded: false,
        auditLogId: null,
      });
      expect(auditLog.rows).toHaveLength(1);
    });
  });

  describe("when the same admin reads it once the window has passed", () => {
    it("writes a second row", async () => {
      await service.recordView(read());
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS + 1_000;

      await expect(service.recordView(read())).resolves.toMatchObject({ recorded: true });
      expect(auditLog.rows).toHaveLength(2);
    });
  });

  describe("when the target is not an aggregate of the caller's organisation", () => {
    it("writes nothing for a missing, a plain or a foreign project", async () => {
      for (const target of ["project_missing", "project_plain", "project_foreign"]) {
        await expect(service.recordView(read(target))).resolves.toEqual({
          recorded: false,
          auditLogId: null,
        });
      }
      expect(auditLog.rows).toEqual([]);
    });
  });
});

describe("auditAggregateRead", () => {
  const fact = {
    organizationId: ORG,
    actorUserId: "user_admin",
    aggregateProjectId: aggregate.id,
    occurredAt: 1_700_000_000_000,
  };
  const views = () => ({
    governanceAuditWorkspaceView: ({
      view,
      occurredAt,
    }: {
      view: RecordWorkspaceViewInput;
      occurredAt: number;
    }) => service.recordView(view, { occurredAt }),
  });

  describe("when the fact is redelivered after the window has passed", () => {
    it("writes one row, because the window reads the fact's time", async () => {
      const handle = auditAggregateRead({ views: views() });
      await handle(fact);
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS * 3;

      await handle(fact);

      expect(auditLog.rows).toHaveLength(1);
    });
  });

  describe("when a later read arrives once the window has passed", () => {
    it("writes a second row", async () => {
      const handle = auditAggregateRead({ views: views() });
      await handle(fact);
      nowMs += ADMIN_WORKSPACE_VIEW_DEDUP_MS + 1_000;

      await handle({ ...fact, occurredAt: nowMs });

      expect(auditLog.rows).toHaveLength(2);
    });
  });
});
