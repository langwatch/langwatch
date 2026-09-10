import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryWorkflowRepositories } from "./memory/memory.workflow.repositories.ts";
import { PostgresWorkflowRepositories } from "./prisma/prisma.workflow.repositories.ts";
import type { WorkflowProjectEnvironmentRepository } from "./workflow-project-environment.repository.ts";
import type { WorkflowRowRepository } from "./workflow-row.repository.ts";
import type { WorkflowRepository } from "./workflow.repository.ts";

/**
 * The rows the workflow module owns, chosen once at boot: the graph and its
 * versions, the bare row a Studio copy lands in, and the project environment a
 * run executes with. Postgres holds every one of them in a deployment that has
 * Postgres; the memory tier holds them in a process that does not.
 */
export interface WorkflowRepositories {
  readonly workflows: WorkflowRepository;
  readonly workflowRows: WorkflowRowRepository;
  readonly projectEnvironment: WorkflowProjectEnvironmentRepository;
}

export const workflowRepositories = defineRepositories({
  live: PostgresWorkflowRepositories,
  memory: MemoryWorkflowRepositories,
});
