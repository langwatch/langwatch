import type { ModelProviderService } from "@langwatch/model-provider-contract";
import {
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
  type WorkflowLlmParameterResolution,
} from "@langwatch/workflow-server";
import { getProjectModelProviders } from "~/server/api/routers/modelProviders.utils";
import { decrypt } from "~/utils/encryption";

type ProjectEnvironmentDatabase = {
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

export type WorkflowEnvironmentEncryption = {
  decrypt(value: string): string;
};

export class AppWorkflowEnvironmentEncryption implements WorkflowEnvironmentEncryption {
  static create(): AppWorkflowEnvironmentEncryption {
    return new AppWorkflowEnvironmentEncryption();
  }

  private constructor() {}

  decrypt(value: string): string {
    return decrypt(value);
  }
}

/** Application database and encryption adapter for Studio runtime credentials. */
export class AppWorkflowProjectEnvironmentPort extends WorkflowProjectEnvironmentPort {
  static create(input: {
    database: ProjectEnvironmentDatabase;
    encryption: WorkflowEnvironmentEncryption;
  }): AppWorkflowProjectEnvironmentPort {
    return new AppWorkflowProjectEnvironmentPort(input);
  }

  private constructor(
    private readonly options: {
      database: ProjectEnvironmentDatabase;
      encryption: WorkflowEnvironmentEncryption;
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

/** Application model-provider adapter for Studio's LiteLLM execution wire. */
export class AppWorkflowLlmParametersPort extends WorkflowLlmParametersPort {
  static create(input: {
    modelProviders: ModelProviderService;
  }): AppWorkflowLlmParametersPort {
    return new AppWorkflowLlmParametersPort(input.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  async resolve(input: {
    projectId: string;
    models: readonly string[];
  }): Promise<readonly WorkflowLlmParameterResolution[]> {
    const providers = await getProjectModelProviders(
      this.modelProviders,
      input.projectId,
    );

    return Promise.all(
      input.models.map(async (model) => {
        const provider = model.split("/")[0]!;
        const modelProvider = providers[provider];
        if (!modelProvider) {
          return { model, provider, configured: false, enabled: false };
        }
        if (!modelProvider.enabled) {
          return { model, provider, configured: true, enabled: false };
        }

        return {
          model,
          provider,
          configured: true,
          enabled: true,
          litellmParams: await this.modelProviders.prepareExecution({
            model,
            projectId: input.projectId,
          }),
        };
      }),
    );
  }
}
