import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  type OrganizationApi,
  type OrganizationTeam,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { TestProjectApi } from "../../__tests__/support/test-project-api.ts";
import type { GovernanceOcsfEventWriter } from "../../app/governance.members.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../admin-workspace-view-audit.service.ts";

class RecordingAuditLog implements Pick<AuditLogApi, "record" | "hasRecordedSince"> {
  recent = false;
  hasRecordedSince = vi.fn(async () => this.recent);
  record = vi.fn(async () => ({ id: "audit", occurredAt: 1_700_000_000_000 }));
}

class StubProjects extends TestProjectApi {
  findInternal = (_input: InternalProjectQuery): Promise<InternalProject | null> =>
    Promise.resolve(null);
  ensureInternal = (_input: InternalProjectQuery): Promise<InternalProject> =>
    Promise.resolve({
      id: "governance-project",
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: "internal_governance",
      archivedAtMs: null,
      traceSharingEnabled: false,
    });
}

class StubOcsf implements GovernanceOcsfEventWriter {
  readonly insertEvent = vi.fn(async () => undefined);
}

const at = new Date(0);

type TargetTeam = OrganizationTeam & { memberIds: string[] };

const ownerWorkspace: TargetTeam = {
  id: "team",
  name: "Owner workspace",
  slug: "owner-workspace",
  organizationId: "org",
  isPersonal: true,
  ownerUserId: "owner",
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
  memberIds: [],
};

class StubTeams {
  target: TargetTeam | null = ownerWorkspace;

  api(): Pick<OrganizationApi, "getTeam" | "getTeamWithMembers"> {
    const current = () => {
      if (!this.target) throw new TeamNotFoundError("team");
      const { memberIds, ...team } = this.target;
      return { team, memberIds };
    };
    return createApiFixture<OrganizationApi>({
      getTeam: async () => current().team,
      getTeamWithMembers: async () => {
        const { team, memberIds } = current();
        return {
          ...team,
          members: memberIds.map((userId) => ({
            userId,
            teamId: team.id,
            role: "MEMBER",
            assignedRoleId: null,
            assignedRole: null,
            createdAt: at,
            updatedAt: at,
            user: { id: userId, name: null, email: null, image: null },
          })),
        };
      },
    });
  }
}

const input = {
  actorUserId: "admin",
  organizationId: "org",
  targetTeamId: "team",
  kind: "personal" as const,
};

describe("DefaultGovernanceAdminWorkspaceViewAuditService", () => {
  it("records the scoped view and mirrors it under the audit identifier", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    const ocsf = new StubOcsf();
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: repository,
      teams: teams.api(),
      projects: new StubProjects(),
      events: ocsf,
    });

    await expect(service.recordView(input)).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(repository.record).toHaveBeenCalledWith({
      userId: "admin",
      organizationId: "org",
      action: "governance.viewWorkspaceAs",
      targetKind: "personal_workspace",
      targetId: "team",
      metadata: { kind: "personal", workspaceLabel: "Owner workspace" },
    });
    expect(ocsf.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "governance-project",
        eventId: "audit",
        sourceId: "team",
        sourceType: "personal_workspace",
        actionName: "governance.viewWorkspaceAs",
        targetName: "Owner workspace",
      }),
    );
  });

  it("silently collapses cross-tenant and self-view probes", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    teams.target = null;
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: repository,
      teams: teams.api(),
    });
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });

    teams.target = { ...ownerWorkspace, ownerUserId: "admin" };
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });

    teams.target = { ...ownerWorkspace, isPersonal: false, memberIds: ["admin"] };
    await expect(service.recordView({ ...input, kind: "team" })).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });
  });

  it("records a team workspace using the team audit target", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    teams.target = { ...ownerWorkspace, isPersonal: false, name: "Shared workspace" };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: repository,
      teams: teams.api(),
    });

    await expect(service.recordView({ ...input, kind: "team" })).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(repository.record).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: "team_workspace",
        metadata: { kind: "team", workspaceLabel: "Shared workspace" },
      }),
    );
  });

  it("deduplicates the same privileged view within five minutes", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    repository.recent = true;
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: repository,
      teams: teams.api(),
      clock: () => 1_700_000_000_000,
    });
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });
    expect(repository.hasRecordedSince).toHaveBeenCalledWith(
      expect.objectContaining({ sinceMs: 1_699_999_700_000 }),
    );
  });

  it("keeps the authoritative audit when the OCSF mirror fails", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    const ocsf = new StubOcsf();
    ocsf.insertEvent.mockRejectedValueOnce(new Error("ClickHouse unavailable"));
    const diagnostics = { warn: vi.fn() };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: repository,
      teams: teams.api(),
      projects: new StubProjects(),
      events: ocsf,
      diagnostics,
    });

    await expect(service.recordView(input)).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(diagnostics.warn).toHaveBeenCalledOnce();
  });
});
