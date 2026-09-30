import { memoryObjectStorage } from "@langwatch/process-stores";

import { ObjectStorageNlpPayloadStagingRepository } from "../object-storage/object-storage.nlp-payload-staging.repository.ts";
import type { WorkflowRepositories } from "../workflow-repositories.registry.ts";
import { MemoryNlpLambdaArnRepository } from "./memory.nlp-lambda-arn.repository.ts";
import { WorkflowLineageMemoryRepository } from "./memory.workflow-lineage.repository.ts";
import { WorkflowProjectEnvironmentMemoryRepository } from "./memory.workflow-project-environment.repository.ts";
import { WorkflowRowMemoryRepository } from "./memory.workflow-row.repository.ts";
import { WorkflowMemoryRepository } from "./memory.workflow.repository.ts";
import { WorkflowMemoryStore } from "./workflow-memory.store.ts";

/** The "memory" tier: every workflow row the app is tested without a datastore. */
export class MemoryWorkflowRepositories {
  static readonly requires = [] as const;

  static create(): WorkflowRepositories {
    // One store behind every row, the way one Prisma client serves them: the
    // workflow a copy row writes is the workflow the lifecycle then commits a
    // version against.
    const store = WorkflowMemoryStore.create();

    return {
      workflows: WorkflowMemoryRepository.create(store),
      workflowRows: WorkflowRowMemoryRepository.create(store),
      projectEnvironment: WorkflowProjectEnvironmentMemoryRepository.create(store),
      lineage: WorkflowLineageMemoryRepository.create(store),
      nlpLambdaArns: MemoryNlpLambdaArnRepository.create(),
      payloadStaging: ObjectStorageNlpPayloadStagingRepository.create({
        objectStorage: memoryObjectStorage(),
      }),
    };
  }
}
