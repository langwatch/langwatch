/**
 * A project's stored run environment, in memory.
 *
 * A project with no row answers with an empty environment rather than a throw:
 * the Prisma tier's `findUniqueOrThrow` is a schema guarantee, and a process
 * composed without Postgres has no project table to guarantee it against.
 */
import {
  WorkflowProjectEnvironmentRepository,
  type StoredProjectEnvironment,
} from "../workflow-project-environment.repository.ts";
import type { WorkflowMemoryStore } from "./workflow-memory.store.ts";

export class WorkflowProjectEnvironmentMemoryRepository extends WorkflowProjectEnvironmentRepository {
  static create(store: WorkflowMemoryStore): WorkflowProjectEnvironmentMemoryRepository {
    return new WorkflowProjectEnvironmentMemoryRepository(store);
  }

  private constructor(private readonly store: WorkflowMemoryStore) {
    super();
  }

  findEnvironment(input: { projectId: string }): Promise<StoredProjectEnvironment> {
    const row = this.store.environments.get(input.projectId);

    return Promise.resolve({ apiKey: row?.apiKey ?? "", secrets: row?.secrets ?? [] });
  }
}
