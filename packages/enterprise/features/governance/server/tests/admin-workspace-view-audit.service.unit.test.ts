import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";
import {
  AdminWorkspaceViewAuditRepository,
  AdminWorkspaceViewOcsfPort,
  type AdminWorkspaceTarget,
} from "../src/ports/admin-workspace-view-audit.port";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../src/services/admin-workspace-view-audit.service";
import { TestProjectService } from "./support/test-project-service";

class MemoryAuditRepository extends AdminWorkspaceViewAuditRepository {
  target: AdminWorkspaceTarget | null = {
    id: "team",
    organizationId: "org",
    ownerUserId: "owner",
    isPersonal: true,
    name: "Owner workspace",
    actorIsMember: false,
  };
  recent = false;
  tryFindTarget = vi.fn(async () => this.target);
  findRecent = vi.fn(async () => this.recent);
  create = vi.fn(async () => ({ id: "audit", createdAtMs: 1_700_000_000_000 }));
}

class StubProjects extends TestProjectService {
  tryFindInternal = (_input: InternalProjectQuery): Promise<InternalProject | null> =>
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

class StubOcsf extends AdminWorkspaceViewOcsfPort {
  readonly mirror = vi.fn(async () => undefined);
}

const input = {
  actorUserId: "admin",
  organizationId: "org",
  targetTeamId: "team",
  kind: "personal" as const,
};

describe("DefaultGovernanceAdminWorkspaceViewAuditService", () => {
  it("records the scoped view and mirrors it under the audit identifier", async () => {
    const repository = new MemoryAuditRepository();
    const ocsf = new StubOcsf();
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository,
      projects: new StubProjects(),
      ocsf,
    });

    await expect(service.recordView(input)).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(repository.create).toHaveBeenCalledWith({
      actorUserId: "admin",
      organizationId: "org",
      targetKind: "personal_workspace",
      targetId: "team",
      metadata: { kind: "personal", workspaceLabel: "Owner workspace" },
    });
    expect(ocsf.mirror).toHaveBeenCalledWith({
      tenantId: "governance-project",
      auditLogId: "audit",
      createdAtMs: 1_700_000_000_000,
      view: input,
      label: "Owner workspace",
    });
  });

  it("silently collapses cross-tenant and self-view probes", async () => {
    const repository = new MemoryAuditRepository();
    repository.target = { ...repository.target!, organizationId: "foreign" };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository,
    });
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });

    repository.target = {
      ...repository.target!,
      organizationId: "org",
      ownerUserId: "admin",
    };
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });

    repository.target = {
      ...repository.target!,
      ownerUserId: "owner",
      isPersonal: false,
      actorIsMember: true,
    };
    await expect(service.recordView({ ...input, kind: "team" })).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });
  });

  it("records a team workspace using the team audit target", async () => {
    const repository = new MemoryAuditRepository();
    repository.target = {
      ...repository.target!,
      isPersonal: false,
      name: "Shared workspace",
    };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository,
    });

    await expect(service.recordView({ ...input, kind: "team" })).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetKind: "team_workspace",
        metadata: { kind: "team", workspaceLabel: "Shared workspace" },
      }),
    );
  });

  it("deduplicates the same privileged view within five minutes", async () => {
    const repository = new MemoryAuditRepository();
    repository.recent = true;
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository,
      clock: () => 1_700_000_000_000,
    });
    await expect(service.recordView(input)).resolves.toEqual({
      recorded: false,
      auditLogId: null,
    });
    expect(repository.findRecent).toHaveBeenCalledWith(
      expect.objectContaining({ sinceMs: 1_699_999_700_000 }),
    );
  });

  it("keeps the authoritative audit when the OCSF mirror fails", async () => {
    const repository = new MemoryAuditRepository();
    const ocsf = new StubOcsf();
    ocsf.mirror.mockRejectedValueOnce(new Error("ClickHouse unavailable"));
    const diagnostics = { warn: vi.fn() };
    const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository,
      projects: new StubProjects(),
      ocsf,
      diagnostics,
    });

    await expect(service.recordView(input)).resolves.toEqual({
      recorded: true,
      auditLogId: "audit",
    });
    expect(diagnostics.warn).toHaveBeenCalledOnce();
  });
});
