import { z } from "zod";
import { moduleApi } from "@langwatch/runtime-composition";

export const MANAGED_PROVIDER_FEATURE_ID = "managed-provider" as const;

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

export interface ManagedProviderApi {
  isManagedProvider(input: { organizationId: string; provider: string }): boolean;

  buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>>;
}

export const ManagedProviderApi = moduleApi<ManagedProviderApi>(MANAGED_PROVIDER_FEATURE_ID);

/** Compatibility type for service-level tests and existing package callers. */
export abstract class ManagedProviderService implements ManagedProviderApi {
  abstract isManagedProvider(input: { organizationId: string; provider: string }): boolean;
  abstract buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>>;
}
