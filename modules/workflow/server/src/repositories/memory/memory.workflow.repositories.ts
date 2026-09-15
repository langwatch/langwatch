import type { WorkflowRepositories } from "../workflow-repositories.registry.ts";
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
    };
  }
}
