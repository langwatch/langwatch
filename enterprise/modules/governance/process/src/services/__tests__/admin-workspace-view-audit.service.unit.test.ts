import type { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  type OrganizationApi,
  type OrganizationTeam,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type {
  InternalProject,
  InternalProjectQuery,
  ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceOcsfEventWriter } from "../../repositories/governance.repositories.ts";
import {
  DefaultGovernanceAdminWorkspaceViewAuditService,
  type WorkspaceViewMirrorOutbox,
} from "../admin-workspace-view-audit.service.ts";

class RecordingAuditLog implements Pick<AuditLogApi, "record" | "hasRecordedSince"> {
  recent = false;
  hasRecordedSince = vi.fn(async () => this.recent);
  record = vi.fn(async () => ({ id: "audit", occurredAt: 1_700_000_000_000 }));
}

function stubProjects(): ProjectApi {
  return createApiFixture<ProjectApi>(
    {
      findInternal: (_input: InternalProjectQuery): Promise<InternalProject | null> =>
        Promise.resolve(null),
      ensureInternal: (_input: InternalProjectQuery): Promise<InternalProject> =>
        Promise.resolve({
          id: "governance-project",
          name: "Governance (internal)",
          slug: "governance-org",
          teamId: "team",
          kind: "internal_governance",
          archivedAtMs: null,
          traceSharingEnabled: false,
        }),
    },
    "ProjectApi",
  );
}

class StubOcsf implements GovernanceOcsfEventWriter {
  readonly insertEvent = vi.fn(async () => undefined);
}

class RecordingOutbox implements WorkspaceViewMirrorOutbox {
  readonly record = vi.fn<WorkspaceViewMirrorOutbox["record"]>(async () => undefined);
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
  /** @scenario "Audit rows for personal and team workspace views are unchanged" */
  it("records the scoped view and mirrors it under the audit identifier", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    const outbox = new RecordingOutbox();
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      targets: stubProjects(),
      auditLog: repository,
      teams: teams.api(),
      projects: stubProjects(),
      events: new StubOcsf(),
      outbox: () => outbox,
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
    expect(repository.record).toHaveBeenCalledTimes(1);
    expect(outbox.record).toHaveBeenCalledWith(expect.objectContaining({ auditLogId: "audit" }));
  });

  describe("when a privileged view is recorded from a request", () => {
    /** @scenario "A recorded workspace view queues its OCSF mirror for the worker" */
    it("queues one mirror intent keyed by the audit row and writes no OCSF row itself", async () => {
      const ocsf = new StubOcsf();
      const outbox = new RecordingOutbox();
      const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
        targets: stubProjects(),
        auditLog: new RecordingAuditLog(),
        teams: new StubTeams().api(),
        projects: stubProjects(),
        events: ocsf,
        outbox: () => outbox,
      });

      await expect(service.recordView(input)).resolves.toEqual({
        recorded: true,
        auditLogId: "audit",
      });
      expect(outbox.record).toHaveBeenCalledExactlyOnceWith({
        auditLogId: "audit",
        occurredAt: 1_700_000_000_000,
        organizationId: "org",
        actorUserId: "admin",
        kind: "personal",
        targetId: "team",
        targetKind: "personal_workspace",
        label: "Owner workspace",
      });
      expect(ocsf.insertEvent).not.toHaveBeenCalled();
    });
  });

  it("silently collapses cross-tenant and self-view probes", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    teams.target = null;
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      targets: stubProjects(),
      auditLog: repository,
      teams: teams.api(),
      projects: stubProjects(),
      events: new StubOcsf(),
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
      targets: stubProjects(),
      auditLog: repository,
      teams: teams.api(),
      projects: stubProjects(),
      events: new StubOcsf(),
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
      targets: stubProjects(),
      auditLog: repository,
      teams: teams.api(),
      projects: stubProjects(),
      events: new StubOcsf(),
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

  /** @scenario "The view is answered even when its OCSF mirror cannot be queued" */
  it("keeps the authoritative audit when the OCSF mirror cannot be queued", async () => {
    const repository = new RecordingAuditLog();
    const teams = new StubTeams();
    const outbox = new RecordingOutbox();
    outbox.record.mockRejectedValueOnce(new Error("outbox unavailable"));
    const diagnostics = { warn: vi.fn() };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      targets: stubProjects(),
      auditLog: repository,
      teams: teams.api(),
      projects: stubProjects(),
      events: new StubOcsf(),
      outbox: () => outbox,
      diagnostics,
    });

    await expect(service.recordView(input)).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(diagnostics.warn).toHaveBeenCalledOnce();
  });
});
