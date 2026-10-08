/**
 * Workflow records a version with its fields while it is current, and an archive, as facts.
 * Spec: modules/workflow/specs/workflow-service.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { EventingCommands } from "@langwatch/eventing";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowDsl } from "@langwatch/workflow-contract";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowLifecyclePipeline } from "../../eventing/workflow-lifecycle.pipeline.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { StudioEventPreparer } from "../../services/studio-event-preparer.service.ts";
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
      evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
      modelProviders: createApiFixture<ModelProviderApi>({}, "ModelProviderApi"),
      agents: createApiFixture<AgentApi>({}, "AgentApi"),
      authz: createApiFixture<AuthzApi>({}, "AuthzApi"),
      apiKeys: createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      experiments: createApiFixture<ExperimentApi>({}, "ExperimentApi"),
      datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
      monitors: createApiFixture<MonitorApi>({}, "MonitorApi"),
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
});
