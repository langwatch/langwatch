/**
 * What a test hands the workflow module in place of a process: every
 * members member it declares, each one throwing when a test reaches it
 * without saying so first.
 */
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { StudioWorkflow, Workflow } from "@langwatch/workflow-contract";
import type { WorkflowService } from "../../services/workflow.service.ts";

import type {
  WorkflowCodeCompletions,
  WorkflowCommitMessageWriter,
  WorkflowEvaluationTrigger,
  WorkflowInfrastructure,
  WorkflowLineageReads,
  WorkflowPermissionProbe,
  WorkflowPublicationReads,
  WorkflowSignals,
  WorkflowStudioRuns,
} from "../workflow.app.ts";
import {
  WorkflowAgentMapping,
  WorkflowStudioDsl,
} from "../../app/workflow.app.ts";
import {
  WorkflowRowRepository,
  type WorkflowRowDraft,
} from "../../repositories/workflow-row.repository.ts";

/** A Studio graph prepared by doing nothing to it. */
class UnchangedStudioDsl implements WorkflowStudioDsl {
  prepare(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    return Promise.resolve(input.dsl);
  }
}

/** Agent mappings nothing recomputes. */
class UnrecordedAgentMappings implements WorkflowAgentMapping {
  recompute(): Promise<void> {
    return Promise.resolve();
  }
}

/** The bare rows a copy lands in, kept in memory. */
class RecordingWorkflowRows extends WorkflowRowRepository {
  readonly created: WorkflowRowDraft[] = [];

  create(input: WorkflowRowDraft): Promise<void> {
    this.created.push(input);

    return Promise.resolve();
  }
}

/** Nothing is granted anywhere unless a test says otherwise. */
const deniedPermissions: WorkflowPermissionProbe = {
  has: () => Promise.resolve(false),
  hasMany: () => Promise.resolve(new Map<string, boolean>()),
};

/** A project with no copy lineage and nothing hanging off its workflows. */
const emptyLineage: WorkflowLineageReads = {
  listWithCopyLineage: () => Promise.resolve([]),
  findWorkflow: () => Promise.resolve(null),
  findCopiesWithPath: () => Promise.resolve(null),
  findWorkflowWithSource: () => Promise.resolve(null),
  findWorkflowWithCopies: () => Promise.resolve(null),
  findLatestVersionNumber: () => Promise.resolve(null),
  listAgents: () => Promise.resolve([]),
  listMonitorsForEvaluators: () => Promise.resolve([]),
  cascadeArchive: () => {
    throw new Error("no cascade was configured for this test");
  },
};

const noPublications: WorkflowPublicationReads = {
  findFlags: () => Promise.resolve(null),
  findVersion: () => Promise.resolve(null),
  setFlags: () => Promise.resolve(),
  listPublishedComponents: () => Promise.resolve([]),
};

const noCommitMessages: WorkflowCommitMessageWriter = {
  generate: () => Promise.resolve("generated"),
};

const noEvaluations: WorkflowEvaluationTrigger = {
  trigger: () => {
    throw new Error("no evaluations pipeline was configured for this test");
  },
};

const noCodeCompletions: WorkflowCodeCompletions = {
  complete: () => Promise.resolve({}),
};

const noStudioRuns: WorkflowStudioRuns = {
  postEvent: () => Promise.resolve(),
};

const silentSignals: WorkflowSignals = {
  workflowCreated: () => void 0,
  failed: () => void 0,
};

/** The whole members, with any member a test cares about overridden. */
export function createWorkflowTestInfrastructure(
  overrides: Partial<WorkflowInfrastructure> = {},
): WorkflowInfrastructure {
  return {
    workflows: createApiFixture<WorkflowService>({}, "WorkflowService"),
    evaluators: createApiFixture<EvaluatorApi>({}, "EvaluatorApi"),
    datasets: createApiFixture<DatasetApi>({}, "DatasetApi"),
    studioDsl: new UnchangedStudioDsl(),
    agentMappings: new UnrecordedAgentMappings(),
    workflowRows: new RecordingWorkflowRows(),
    permissions: deniedPermissions,
    lineage: emptyLineage,
    publications: noPublications,
    commitMessages: noCommitMessages,
    evaluations: noEvaluations,
    codeCompletions: noCodeCompletions,
    studioRuns: noStudioRuns,
    signals: silentSignals,
    ...overrides,
  };
}

/** The graph service, answering one project's workflows and nothing else. */
export function createWorkflowTestService(workflows: readonly Workflow[]): WorkflowService {
  return createApiFixture<WorkflowService>(
    { list: () => Promise.resolve([...workflows]) },
    "WorkflowService",
  );
}
