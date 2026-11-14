import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { InMemoryProcessStore } from "@langwatch/eventing";
import { type OrganizationApi, type OrganizationTeam } from "@langwatch/organization-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { GovernanceModule } from "../../app/governance.app.ts";
import type { GovernanceRepositories } from "../../repositories/governance.repositories.ts";
import { MemoryOcsfEventsRepository } from "../../repositories/memory/memory.ocsf-events.repository.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../../services/admin-workspace-view-audit.service.ts";
import { governanceActivityMonitorEventing } from "../governance-activity-monitor.pipeline.ts";
import { OutboxWorkspaceViewMirror } from "../workspace-view-mirror.intent.ts";
import {
  WORKSPACE_VIEW_MIRROR_PROCESS_KEY,
  WORKSPACE_VIEW_MIRROR_PROCESS_NAME,
  workspaceViewMirrorIntentSchema,
} from "../workspace-view-mirror.process.ts";

const GOVERNANCE_PROJECT = "governance-project";
const at = new Date(0);
const workspace: OrganizationTeam = {
  id: "team",
  name: "Owner workspace",
  slug: "owner-workspace",
  organizationId: "org",
  isPersonal: true,
  ownerUserId: "owner",
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
};

function setUp() {
  const processStore = InMemoryProcessStore.createForTesting();
  const outbox = OutboxWorkspaceViewMirror.create(processStore);
  const ocsf = MemoryOcsfEventsRepository.create();
  const projects = createApiFixture<ProjectApi>({
    ensureInternal: async () => ({
      id: GOVERNANCE_PROJECT,
      name: "Governance (internal)",
      slug: "governance-org",
      teamId: "team",
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      archivedAtMs: null,
      traceSharingEnabled: false,
    }),
  });
  const service = DefaultGovernanceAdminWorkspaceViewAuditService.create({
    auditLog: createApiFixture<AuditLogApi>({
      hasRecordedSince: async () => false,
      record: async () => ({ id: "audit_1", occurredAt: 1_700_000_000_000 }),
    }),
    teams: createApiFixture<OrganizationApi>({
      getTeam: async () => workspace,
      getTeamWithMembers: async () => ({ ...workspace, members: [] }),
    }),
    targets: projects,
    projects,
    events: ocsf,
    outbox: () => outbox,
  });
  const queued = async () =>
    processStore.findMessagesByRef({
      ref: {
        processName: WORKSPACE_VIEW_MIRROR_PROCESS_NAME,
        projectId: "org",
        processKey: WORKSPACE_VIEW_MIRROR_PROCESS_KEY,
      },
    });
  const mirrored = async () =>
    ocsf.findAll({ tenantId: GOVERNANCE_PROJECT, sinceMs: 0, sinceEventId: "", limit: 10 });
  return { service, outbox, ocsf, queued, mirrored };
}

const view = {
  actorUserId: "admin",
  organizationId: "org",
  targetTeamId: "team",
  kind: "personal" as const,
};

describe("the workspace-view OCSF mirror", () => {
  describe("when the worker handles the intent a recorded view queued", () => {
    /** @scenario "The worker writes the view's OCSF row from the queued intent" */
    it("writes one OCSF row under the internal governance project, keyed by the audit row", async () => {
      const { service, queued, mirrored } = setUp();
      await service.recordView(view);
      expect(await mirrored()).toEqual([]);

      const [message] = await queued();
      await service.mirrorView(workspaceViewMirrorIntentSchema.parse(message!.payload));

      expect(await mirrored()).toEqual([expect.objectContaining({ eventId: "audit_1" })]);
    });
  });

  describe("when the same mirror is queued and delivered twice", () => {
    /** @scenario "A redelivered mirror intent writes one OCSF row" */
    it("keeps one intent and one OCSF row for the audit row", async () => {
      const { service, outbox, queued, mirrored } = setUp();
      await service.recordView(view);
      const [message] = await queued();
      const intent = workspaceViewMirrorIntentSchema.parse(message!.payload);

      await outbox.record(intent);
      await service.mirrorView(intent);
      await service.mirrorView(intent);

      expect(await queued()).toHaveLength(1);
      expect(await mirrored()).toHaveLength(1);
    });
  });

  describe("when the OCSF insert fails in the worker", () => {
    /** @scenario "A failed OCSF insert is retried by the worker" */
    it("rejects, so the outbox delivers the intent again", async () => {
      const { service, ocsf, queued } = setUp();
      vi.spyOn(ocsf, "insertEvent").mockRejectedValueOnce(new Error("ClickHouse unavailable"));
      await service.recordView(view);
      const [message] = await queued();
      const intent = workspaceViewMirrorIntentSchema.parse(message!.payload);

      await expect(service.mirrorView(intent)).rejects.toThrow("ClickHouse unavailable");
      await expect(service.mirrorView(intent)).resolves.toBeUndefined();
    });
  });

  describe("when the activity monitor pipeline is built", () => {
    it("connects the mirror outbox and runs its process manager", () => {
      const processStore = InMemoryProcessStore.createForTesting();
      const connectWorkspaceViewMirrorOutbox = vi.fn();
      const definition = governanceActivityMonitorEventing.build({
        participation: "consume",
        repositories: createApiFixture<GovernanceRepositories>({}),
        app: createApiFixture<GovernanceModule>({
          connectAnomalyAlertOutbox: vi.fn(),
          connectWorkspaceViewMirrorOutbox,
        }),
        processStore,
      });

      expect(connectWorkspaceViewMirrorOutbox).toHaveBeenCalledWith({ processStore });
      expect(definition.processManagers.has(WORKSPACE_VIEW_MIRROR_PROCESS_NAME)).toBe(true);
    });
  });
});
