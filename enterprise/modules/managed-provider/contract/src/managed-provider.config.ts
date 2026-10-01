import { Secret } from "@langwatch/secrets/secret";
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

/** AWS role and key material for every managed Bedrock deployment: a credential, not config. */
export const managedProviderSecrets = {
  bedrock: Secret.load("MANAGED_BEDROCK_CONFIGS", { optional: true }),
} as const;

/** Parses the resolved secret into the directory, or refuses naming why. */
export function parseManagedBedrockDirectory(raw: string | undefined): ManagedBedrockDirectory {
  const trimmed = raw?.trim();
  if (!trimmed) return {};

  let document: unknown;
  try {
    document = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "MANAGED_BEDROCK_CONFIGS is not valid JSON. Correct it, or remove it to run without managed Bedrock providers.",
    );
  }

  const directory = managedBedrockDirectorySchema.safeParse(document);
  if (!directory.success) {
    throw new Error(
      "MANAGED_BEDROCK_CONFIGS is not a map of organization id to a complete Bedrock deployment. Correct it, or remove it to run without managed Bedrock providers.",
    );
  }
  return directory.data;
}
