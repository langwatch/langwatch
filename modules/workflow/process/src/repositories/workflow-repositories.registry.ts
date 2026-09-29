import { defineRepositories } from "@langwatch/kernel";

import { MemoryWorkflowRepositories } from "./memory/memory.workflow.repositories.ts";
import { PostgresWorkflowRepositories } from "./prisma/prisma.workflow.repositories.ts";
import type { WorkflowLineageRepository } from "./workflow-lineage.repository.ts";
import type { WorkflowProjectEnvironmentRepository } from "./workflow-project-environment.repository.ts";
import type { WorkflowRowRepository } from "./workflow-row.repository.ts";
import type { WorkflowRepository } from "./workflow.repository.ts";

/**
 * The rows the workflow module owns, chosen once at boot: the graph and its versions, the
 * bare row a Studio copy lands in, its lineage and publication flags, and the run
 * environment. Postgres holds them when composed; the memory tier holds them otherwise.
 */
export interface WorkflowRepositories {
  readonly workflows: WorkflowRepository;
  readonly workflowRows: WorkflowRowRepository;
  readonly projectEnvironment: WorkflowProjectEnvironmentRepository;
  readonly lineage: WorkflowLineageRepository;
}

export const workflowRepositories = defineRepositories({
  live: PostgresWorkflowRepositories,
  memory: MemoryWorkflowRepositories,
});
