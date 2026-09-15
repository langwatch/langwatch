import {
  type ManagedBedrockConfig,
  managedBedrockConfigSchema,
} from "@langwatch/enterprise-managed-provider-contract";

export abstract class ManagedProviderConfiguration {
  abstract tryForOrganization(organizationId: string): ManagedBedrockConfig | null;
}

export abstract class ManagedProviderConfigurationReporter {
  abstract info(attributes: Record<string, unknown>, message: string): void;
  abstract warn(attributes: Record<string, unknown>, message: string): void;
}

const PRIVATE_BEDROCK_ENV_PREFIX = "MANAGED_BEDROCK__";

export class ManagedProviderConfigurationService extends ManagedProviderConfiguration {
  private constructor(private readonly configs: ReadonlyMap<string, ManagedBedrockConfig>) {
    super();
  }

  static create(options: {
    source: Readonly<Record<string, string | undefined>>;
    reporter: ManagedProviderConfigurationReporter;
  }): ManagedProviderConfigurationService {
    const configs = new Map<string, ManagedBedrockConfig>();

    for (const [key, value] of Object.entries(options.source)) {
      if (!key.startsWith(PRIVATE_BEDROCK_ENV_PREFIX) || !value) continue;

      const suffix = key.slice(PRIVATE_BEDROCK_ENV_PREFIX.length);
      const lastSeparator = suffix.lastIndexOf("__");
      const organizationId = lastSeparator >= 0 ? suffix.slice(lastSeparator + 2) : suffix;
      if (!organizationId) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        options.reporter.warn(
          { organizationId, environmentVariable: key },
          "Skipping managed Bedrock config: invalid JSON in environment variable",
        );
        continue;
      }

      const result = managedBedrockConfigSchema.safeParse(parsed);
      if (!result.success) {
        options.reporter.warn(
          {
            organizationId,
            environmentVariable: key,
            errors: result.error.flatten().fieldErrors,
          },
          "Skipping managed Bedrock config: validation failed",
        );
        continue;
      }

      if (configs.has(organizationId)) {
        throw new Error(
          `Duplicate managed Bedrock config for orgId "${organizationId}": environment variable "${key}" conflicts with an earlier definition.`,
        );
      }
      configs.set(organizationId, result.data);
      options.reporter.info(
        { organizationId, environmentVariable: key },
        "Loaded managed Bedrock config from environment variable",
      );
    }

    if (configs.size > 0) {
      options.reporter.info(
        { count: configs.size },
        "Managed Bedrock provider instances configured",
      );
    }

    return new ManagedProviderConfigurationService(configs);
  }

  tryForOrganization(organizationId: string): ManagedBedrockConfig | null {
    return this.configs.get(organizationId) ?? null;
  }
}
