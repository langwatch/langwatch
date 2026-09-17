import { Config, compileRuntimeConfig, RuntimeConfig, type ConfigValue } from "@langwatch/config";
import { z } from "zod";

import { managedBedrockConfigSchema } from "./managed-provider.api.ts";

/**
 * Every managed Bedrock deployment, keyed by the organization it serves. The
 * organization is a key inside the value; the earlier `MANAGED_BEDROCK__<field>__<orgId>`
 * put it in the NAME, which only an enumerable source could ever read back.
 */
export const managedBedrockDirectorySchema = z.record(
  z.string().min(1),
  managedBedrockConfigSchema,
);

export type ManagedBedrockDirectory = z.infer<typeof managedBedrockDirectorySchema>;

const bedrockDirectoryLeaf = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const trimmed = raw?.trim();
    if (!trimmed) return {} as ManagedBedrockDirectory;

    let document: unknown;
    try {
      document = JSON.parse(trimmed);
    } catch {
      ctx.addIssue({
        code: "custom",
        message:
          "The managed Bedrock configuration is not valid JSON. Correct it, or remove it to run without managed Bedrock providers.",
      });
      return z.NEVER;
    }

    const directory = managedBedrockDirectorySchema.safeParse(document);
    if (!directory.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "The managed Bedrock configuration is not a map of organization id to a complete Bedrock deployment. Correct it, or remove it to run without managed Bedrock providers.",
      });
      return z.NEVER;
    }
    return directory.data;
  });

export const managedProviderServerConfigDefinition = RuntimeConfig.define({
  bedrock: Config.value(bedrockDirectoryLeaf, { env: "MANAGED_BEDROCK_CONFIGS" }),
});

export type ManagedProviderServerConfig = ConfigValue<typeof managedProviderServerConfigDefinition>;

export const managedProviderServerConfigSchema = compileRuntimeConfig(
  managedProviderServerConfigDefinition,
);

/**
 * What the PROCESS hands the module: the directory it already parsed above.
 * Running the env-reading schema over a resolved record would reject it.
 */
export const managedProviderAppConfigSchema = z
  .object({ bedrock: managedBedrockDirectorySchema.default({}) })
  .default({ bedrock: {} });

export type ManagedProviderAppConfig = z.infer<typeof managedProviderAppConfigSchema>;
