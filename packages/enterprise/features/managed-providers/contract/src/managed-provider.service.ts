import { z } from "zod";

export const MANAGED_PROVIDERS_FEATURE_ID = "managed-providers" as const;

export const managedBedrockConfigSchema = z.object({
  proxyRoleArn: z.string().min(1),
  bedrockRoleArn: z.string().min(1),
  proxyAwsAccessKeyId: z.string().min(1),
  proxyAwsSecretAccessKey: z.string().min(1),
  bedrockProxyEndpoint: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
});

export type ManagedBedrockConfig = z.infer<typeof managedBedrockConfigSchema>;

export const managedModelProviderSchema = z.object({
  provider: z.string().min(1),
});

export type ManagedModelProvider = z.infer<typeof managedModelProviderSchema>;

export type BuildManagedProviderParametersInput = {
  params: Record<string, string>;
  projectId: string;
  model: string;
  modelProvider: ManagedModelProvider;
};

export abstract class ManagedProviderService {
  abstract isManagedProvider(organizationId: string, provider: string): boolean;

  abstract buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>>;
}
