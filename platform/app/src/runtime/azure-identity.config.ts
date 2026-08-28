import { Config, RuntimeConfig, type ConfigValue } from "@langwatch/config";

const azureIdentityConfigDefinition = RuntimeConfig.define({
  tenantId: Config.secret({ optional: true, env: "AZURE_TENANT_ID" }),
  clientId: Config.secret({ optional: true, env: "AZURE_CLIENT_ID" }),
  federatedTokenFile: Config.secret({ optional: true, env: "AZURE_FEDERATED_TOKEN_FILE" }),
});

export type AzureIdentityConfig = Readonly<ConfigValue<typeof azureIdentityConfigDefinition>>;

/** Parses the Azure identity injected by the process platform once at boot. */
export function resolveAzureIdentityConfig(
  source: Readonly<Record<string, unknown>>,
): AzureIdentityConfig {
  return RuntimeConfig.create({
    name: "Azure identity",
    definition: azureIdentityConfigDefinition,
    source,
  }).value;
}
