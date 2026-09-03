import { WorkflowProjectEnvironmentPort } from "../ports/workflow.port";

/**
 * The project credentials and decrypted secrets a Studio run executes with.
 *
 * Moved verbatim from the platform app's
 * `runtime/app/features/workflow-studio-enrichment.adapter.ts`: the two reads,
 * their selections and the decryption pass are unchanged, because what a
 * running graph sees in its environment is customer-visible behaviour.
 *
 * The cipher stays injected. The platform app reached its module-level
 * `decrypt`, which reads the process's own validated environment; a process
 * that composes its own cipher hands it in here instead, and neither can
 * silently become the other.
 */

/** The two tables this adapter reads, named structurally. */
export type WorkflowProjectEnvironmentDatabase = {
  project: {
    findUniqueOrThrow(input: {
      where: { id: string };
      select: { apiKey: true };
    }): Promise<{ apiKey: string }>;
  };
  projectSecret: {
    findMany(input: {
      where: { projectId: string };
      select: { name: true; encryptedValue: true };
    }): Promise<Array<{ name: string; encryptedValue: string }>>;
  };
};

/** The stored-secret cipher, as this adapter asks it. */
export type WorkflowEnvironmentDecryptor = {
  decrypt(value: string): string;
};

/** Reads a project's API key and its decrypted project-scoped secrets. */
export class PrismaWorkflowProjectEnvironmentAdapter extends WorkflowProjectEnvironmentPort {
  static create(input: {
    database: WorkflowProjectEnvironmentDatabase;
    encryption: WorkflowEnvironmentDecryptor;
  }): PrismaWorkflowProjectEnvironmentAdapter {
    return new PrismaWorkflowProjectEnvironmentAdapter(input);
  }

  private constructor(
    private readonly options: {
      database: WorkflowProjectEnvironmentDatabase;
      encryption: WorkflowEnvironmentDecryptor;
    },
  ) {
    super();
  }

  async get(input: {
    projectId: string;
  }): Promise<{ apiKey: string; secrets: Record<string, string> }> {
    const [project, projectSecrets] = await Promise.all([
      this.options.database.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { apiKey: true },
      }),
      this.options.database.projectSecret.findMany({
        where: { projectId: input.projectId },
        select: { name: true, encryptedValue: true },
      }),
    ]);

    return {
      apiKey: project.apiKey,
      secrets: Object.fromEntries(
        projectSecrets.map((secret) => [
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
