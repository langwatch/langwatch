/**
 * The environment a Studio run executes with: the project's API key and its
 * project-scoped secrets, decrypted.
 *
 * The cipher stays injected. The platform app reached its module-level
 * `decrypt`, which reads the process's own validated environment; a process
 * that composes its own cipher hands it in here instead, and neither can
 * silently become the other.
 */
import { WorkflowProjectEnvironmentPort } from "../ports/workflow.port.ts";
import type { WorkflowProjectEnvironmentRepository } from "../repositories/workflow-project-environment.repository.ts";

/** The stored-secret cipher, as this service asks it. */
export type WorkflowEnvironmentDecryptor = {
  decrypt(value: string): string;
};

export class WorkflowProjectEnvironmentService extends WorkflowProjectEnvironmentPort {
  static create(options: {
    repository: WorkflowProjectEnvironmentRepository;
    encryption: WorkflowEnvironmentDecryptor;
  }): WorkflowProjectEnvironmentService {
    return new WorkflowProjectEnvironmentService(options);
  }

  private constructor(
    private readonly options: {
      repository: WorkflowProjectEnvironmentRepository;
      encryption: WorkflowEnvironmentDecryptor;
    },
  ) {
    super();
  }

  async get(input: {
    projectId: string;
  }): Promise<{ apiKey: string; secrets: Record<string, string> }> {
    const stored = await this.options.repository.findEnvironment(input);

    return {
      apiKey: stored.apiKey,
      secrets: Object.fromEntries(
        stored.secrets.map((secret) => [
          secret.name,
          this.options.encryption.decrypt(secret.encryptedValue),
        ]),
      ),
    };
  }
}

/**
 * A deployment with no stored-secret cipher.
 *
 * Refuses rather than passing the ciphertext through: an encrypted provider
 * key handed to a running graph as its own value is a credential the graph
 * would send to a provider verbatim, and the failure that produces is a
 * mystery at the provider rather than a missing key here.
 */
export class UnavailableWorkflowEnvironmentDecryptor implements WorkflowEnvironmentDecryptor {
  static create(): UnavailableWorkflowEnvironmentDecryptor {
    return new UnavailableWorkflowEnvironmentDecryptor();
  }

  private constructor() {}

  decrypt(_value: string): string {
    throw new Error(
      "This process was composed without a stored-secret cipher, so it cannot decrypt a project secret for a workflow run.",
    );
  }
}
