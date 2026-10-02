/** A Studio run's project secrets, read through the secret module's contract. */
import {
  SecretUnreadableError,
  referencedSecretNames,
  type SecretApi,
} from "@langwatch/secret-contract";
import type { StudioWorkflow } from "@langwatch/workflow-contract";

import type { WorkflowProjectEnvironment, WorkflowRunEnvironment } from "../app/workflow.app.ts";

type RunSecretReader = Pick<SecretApi, "list" | "getValuesByName">;

/**
 * Code nodes may build a secret's name at runtime, so every listed secret travels;
 * the listing never holds a reserved one. A secret the graph names must be readable;
 * one it does not name and that cannot be read is left out instead of failing the run.
 */
export class WorkflowProjectEnvironmentService implements WorkflowProjectEnvironment {
  static create(options: { secrets: RunSecretReader }): WorkflowProjectEnvironmentService {
    return new WorkflowProjectEnvironmentService(options.secrets);
  }

  private constructor(private readonly secrets: RunSecretReader) {}

  async get({
    projectId,
    workflow,
  }: {
    projectId: string;
    workflow: StudioWorkflow;
  }): Promise<WorkflowRunEnvironment> {
    const listed = await this.secrets.list({ projectId });

    return {
      secrets: await this.readable({
        projectId,
        names: listed.map(({ name }) => name),
        referenced: new Set(referencedSecretNames(workflow)),
      }),
    };
  }

  private async readable({
    projectId,
    names,
    referenced,
  }: {
    projectId: string;
    names: string[];
    referenced: ReadonlySet<string>;
  }): Promise<Record<string, string>> {
    try {
      return await this.secrets.getValuesByName({ projectId, names });
    } catch (error) {
      const unreadable = error instanceof SecretUnreadableError ? error.meta.name : undefined;
      if (
        typeof unreadable !== "string" ||
        referenced.has(unreadable) ||
        !names.includes(unreadable)
      ) {
        throw error;
      }

      return this.readable({
        projectId,
        names: names.filter((name) => name !== unreadable),
        referenced,
      });
    }
  }
}
