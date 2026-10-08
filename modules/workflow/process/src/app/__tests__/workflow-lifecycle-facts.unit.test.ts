/**
 * Workflow records a version with its fields while it is current, and an archive, as facts.
 * Spec: modules/workflow/specs/workflow-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowLifecyclePipeline } from "../../eventing/workflow-lifecycle.pipeline.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { StudioEventPreparer } from "../../services/studio-event-preparer.service.ts";
import { WorkflowCurrentVersionBackfillService } from "../../services/workflow-current-version-backfill.service.ts";
import { WorkflowService } from "../../services/workflow.service.ts";
import {
  type WorkflowDslMigration,
  type WorkflowExecution,
  type WorkflowId,
  WorkflowModule,
} from "../workflow.app.ts";

const reference = { workflowId: "workflow_1", projectId: "project_1" };
const UNRESOLVED = { inputFields: [], outputFields: [], fieldsResolved: false };

async function setup() {
  const repositories = MemoryWorkflowRepositories.create();
  await repositories.workflows.createWorkflow({
    id: reference.workflowId,
    projectId: reference.projectId,
    name: "Graph",
    icon: null,
    description: null,
  });
  for (const id of ["version_1", "version_2"]) {
    await repositories.workflows.createVersion({
      id,
      ...reference,
      parentId: null,
      version: id,
      autoSaved: false,
      commitMessage: id,
      authorId: "author_1",
      dsl: {} as WorkflowDsl,
    });
  }
  await repositories.workflows.updateWorkflow({
    id: reference.workflowId,
    projectId: reference.projectId,
    data: { currentVersionId: "version_2" },
  });
  const app = await WorkflowModule.create({
    dependencies: {
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      secrets: createApiFixture<SecretApi>({}, "SecretApi"),
    },
    config: {
      nlpServiceUrl: void 0,
      stagingThresholdBytes: void 0,
      stagingTtlSeconds: 600,
      relayTurnCeilingMs: void 0,
      publicBaseUrl: void 0,
      nlpCodeBlockTimeoutSeconds: void 0,
    },
    resources: { own: () => void 0, ownService: () => void 0 },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
  });
  type Commands = EventingCommands<WorkflowLifecyclePipeline>;
  const saved = vi.fn<Commands["recordWorkflowVersionSaved"]["send"]>(async () => void 0);
  const archived = vi.fn<Commands["recordWorkflowArchived"]["send"]>(async () => void 0);
  app.connectLifecycleCommands(
    createApiFixture<Commands>({
      recordWorkflowVersionSaved: createApiFixture<Commands["recordWorkflowVersionSaved"]>({
        send: saved,
      }),
      recordWorkflowArchived: createApiFixture<Commands["recordWorkflowArchived"]>({
        send: archived,
      }),
    }),
  );
  return { app, saved, archived, repositories };
}

describe("workflow lifecycle facts", () => {
  describe("when a workflow is brought back and then archived", () => {
    /** @scenario "Archiving a workflow records the archived fact agents react to" */
    /** @scenario "A version recorded again carries its fields while it is current" */
    it("records the current version with its fields on an unarchive, then the archive", async () => {
      const { app, saved, archived } = await setup();

      await app.archive({
        id: reference.workflowId,
        projectId: reference.projectId,
        unarchive: true,
      });
      await vi.waitFor(() =>
        expect(saved).toHaveBeenCalledWith(
          expect.objectContaining({ ...reference, versionId: "version_2", fields: UNRESOLVED }),
        ),
      );
      expect(archived).not.toHaveBeenCalled();

      await app.archive({ id: reference.workflowId, projectId: reference.projectId });
      await vi.waitFor(() =>
        expect(archived).toHaveBeenCalledWith(expect.objectContaining(reference)),
      );
    });
  });

  describe("when the fields of a version are asked for", () => {
    /** @scenario "A version recorded again carries its fields while it is current" */
    it("answers them for the current version only, and none once the workflow is archived", async () => {
      const { repositories } = await setup();
      const workflows = WorkflowService.create({
        repository: repositories.workflows,
        datasets: createApiFixture<DatasetApi>(),
        execution: createApiFixture<WorkflowExecution>(),
        studioEvents: createApiFixture<StudioEventPreparer>(),
        dslMigration: createApiFixture<WorkflowDslMigration>(),
        ids: createApiFixture<WorkflowId>(),
      });

      expect(
        await workflows.findCurrentVersionFacts({ ...reference, versionId: "version_1" }),
      ).toEqual([]);
      expect(await workflows.findCurrentVersionFacts(reference)).toEqual([
        { versionId: "version_2", authorId: "author_1", fields: UNRESOLVED },
      ]);
      await workflows.archiveLinked(reference);
      expect(await workflows.findCurrentVersionFacts(reference)).toEqual([]);
    });
  });

  describe("when the deploy backfill runs", () => {
    async function backfillSetup() {
      const facts = await setup();
      const { workflows } = facts.repositories;
      for (const [id, projectId] of [
        ["workflow_2", "project_2"],
        ["workflow_3", "project_1"],
      ] as const) {
        await workflows.createWorkflow({ id, projectId, name: id, icon: null, description: null });
      }
      await workflows.archiveLinked({ workflowId: "workflow_3", projectId: "project_1" });
      const backfill = WorkflowCurrentVersionBackfillService.create({
        workflows,
        versions: facts.app,
      });
      return { ...facts, backfill };
    }

    /** @scenario "The deploy backfill records each live workflow's current version with its fields" */
    it("records the current version of each live workflow with its fields once", async () => {
      const { backfill, saved } = await backfillSetup();
      const done: string[] = [];

      const report = await backfill.recordLiveWorkflows({
        dryRun: false,
        signal: new AbortController().signal,
        afterTenantId: null,
        onTenantDone: async ({ tenantId }) => void done.push(tenantId),
      });

      expect(report).toEqual({ tenants: 2, liveWorkflows: 2, versionsRecorded: 1 });
      expect(saved).toHaveBeenCalledTimes(1);
      expect(saved).toHaveBeenCalledWith(
        expect.objectContaining({ ...reference, versionId: "version_2", fields: UNRESOLVED }),
      );
      expect(done).toEqual(["project_1", "project_2"]);
    });

    /** @scenario "The deploy backfill records each live workflow's current version with its fields" */
    it("records nothing on a dry run, and skips the projects a resumed run finished", async () => {
      const { backfill, saved } = await backfillSetup();
      const onTenantDone = vi.fn(async () => void 0);
      const signal = new AbortController().signal;

      const dry = await backfill.recordLiveWorkflows({
        dryRun: true,
        signal,
        afterTenantId: null,
        onTenantDone,
      });
      const resumed = await backfill.recordLiveWorkflows({
        dryRun: false,
        signal,
        afterTenantId: "project_1",
        onTenantDone,
      });

      expect(dry).toEqual({ tenants: 2, liveWorkflows: 2, versionsRecorded: 0 });
      expect(resumed).toEqual({ tenants: 1, liveWorkflows: 1, versionsRecorded: 0 });
      expect(saved).not.toHaveBeenCalled();
      expect(onTenantDone).toHaveBeenCalledTimes(1);
    });
  });
});
