import { setModelProvider as apiSetModelProvider } from "../langwatch-api-model-providers.js";

/**
 * Handles the platform_set_model_provider MCP tool invocation.
 *
 * Creates or updates a model provider configuration, including API keys.
 * Returns confirmation with the updated provider status.
 */
export async function handleSetModelProvider(params: {
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown>;
  defaultModel?: string;
}): Promise<string> {
  const providers = await apiSetModelProvider(params);

  const updated = providers[params.provider];

  const lines: string[] = [];
  lines.push("Model provider updated successfully!\n");
  lines.push(`**Provider**: ${params.provider}`);
  lines.push(`**Status**: ${updated?.enabled ? "enabled" : "disabled"}`);

  if (updated?.customKeys) {
    const keyFields = Object.entries(updated.customKeys)
      .map(([k, v]) => `${k}: ${v ? "set" : "not set"}`)
      .join(", ");
    lines.push(`**Keys**: ${keyFields}`);
  }

  if (params.defaultModel) {
    lines.push(`**Default Model**: ${params.defaultModel}`);
  }

  return lines.join("\n");
}
