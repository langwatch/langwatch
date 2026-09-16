/** Execution environment: project API key and decrypted secrets with injected cipher. */
import { type WorkflowProjectEnvironment } from "../app/workflow.app.ts";
import type { WorkflowProjectEnvironmentRepository } from "../repositories/workflow-project-environment.repository.ts";

/** The stored-secret cipher, as this service asks it. */
export type WorkflowEnvironmentDecryptor = {
  decrypt(value: string): string;
};

export class WorkflowProjectEnvironmentService implements WorkflowProjectEnvironment {
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
  ) {}

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
 * A deployment with no stored-secret cipher. Refuses rather than passing the
 * ciphertext through: a graph sending an encrypted provider key verbatim
 * fails as a mystery at the provider, not a missing key here.
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
