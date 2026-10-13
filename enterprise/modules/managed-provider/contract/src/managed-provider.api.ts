import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

export const MANAGED_PROVIDER_FEATURE_ID = "managed-provider" as const;

const managedBedrockConfigSchemaDefinition = z.object({
  proxyRoleArn: z.string().min(1),
  bedrockRoleArn: z.string().min(1),
  proxyAwsAccessKeyId: z.string().min(1),
  proxyAwsSecretAccessKey: z.string().min(1),
  bedrockProxyEndpoint: z.string().min(1),
  region: z.string().min(1).default("us-east-1"),
});
export interface ManagedBedrockConfigSchema extends Named<
  typeof managedBedrockConfigSchemaDefinition
> {}
export const managedBedrockConfigSchema: ManagedBedrockConfigSchema =
  managedBedrockConfigSchemaDefinition;

export type ManagedBedrockConfig = z.infer<typeof managedBedrockConfigSchema>;

const managedModelProviderSchemaDefinition = z.object({
  provider: z.string().min(1),
});
export interface ManagedModelProviderSchema extends Named<
  typeof managedModelProviderSchemaDefinition
> {}
export const managedModelProviderSchema: ManagedModelProviderSchema =
  managedModelProviderSchemaDefinition;

export type ManagedModelProvider = z.infer<typeof managedModelProviderSchema>;

export type BuildManagedProviderParametersInput = {
  params: Record<string, string>;
  projectId: string;
  /** The project's organization, named by the caller, whose managed deployment applies. */
  organizationId: string;
  model: string;
  modelProvider: ManagedModelProvider;
};

export interface ManagedProviderApi {
  isManagedProvider(input: { organizationId: string; provider: string }): boolean;

  buildLitellmParameters(
    input: BuildManagedProviderParametersInput,
  ): Promise<Record<string, string>>;
}

export const ManagedProviderApi = moduleApi<ManagedProviderApi>()(MANAGED_PROVIDER_FEATURE_ID);
