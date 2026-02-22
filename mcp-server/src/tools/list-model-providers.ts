import { listModelProviders as apiListModelProviders } from "../langwatch-api-model-providers.js";

/**
 * Handles the platform_list_model_providers MCP tool invocation.
 *
 * Lists all model providers for the project, showing provider name,
 * enabled status, and which key fields are set (masked).
 */
export async function handleListModelProviders(): Promise<string> {
  const providers = await apiListModelProviders();

  const entries = Object.entries(providers);
  if (entries.length === 0) {
    return "No model providers configured for this project.\n\n> Tip: Use `platform_set_model_provider` to configure an API key for a model provider.";
  }

  const lines: string[] = [];
  lines.push(`# Model Providers (${entries.length} total)\n`);

  for (const [key, provider] of entries) {
    const status = provider.enabled ? "enabled" : "disabled";
    lines.push(`## ${key}`);
    lines.push(`**Status**: ${status}`);

    if (provider.customKeys) {
      const keyFields = Object.entries(provider.customKeys)
        .map(([k, v]) => `${k}: ${v ? "set" : "not set"}`)
        .join(", ");
      lines.push(`**Keys**: ${keyFields}`);
    }

    if (provider.models && provider.models.length > 0) {
      lines.push(`**Models**: ${provider.models.length} available`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
