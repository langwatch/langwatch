import { listApiKeys as apiListApiKeys } from "../langwatch-api-api-keys.js";

export async function handleListApiKeys(): Promise<string> {
  const result = await apiListApiKeys();
  const keys = result.data;

  if (!Array.isArray(keys) || keys.length === 0) {
    return "No API keys found.\n\n> Tip: Use `platform_create_api_key` to create a new key.";
  }

  const lines: string[] = [];
  lines.push(`# API Keys (${keys.length} total)\n`);

  for (const k of keys) {
    const status = k.revokedAt ? "REVOKED" : k.expiresAt && new Date(k.expiresAt) < new Date() ? "EXPIRED" : "ACTIVE";
    lines.push(`## ${k.name}`);
    lines.push(`**ID**: ${k.id}`);
    lines.push(`**Status**: ${status}`);
    if (k.description) lines.push(`**Description**: ${k.description}`);
    if (k.expiresAt) lines.push(`**Expires**: ${k.expiresAt}`);
    if (k.lastUsedAt) lines.push(`**Last Used**: ${k.lastUsedAt}`);
    lines.push(`**Created**: ${k.createdAt}`);
    if (k.roleBindings.length > 0) {
      const bindings = k.roleBindings
        .map((rb) => `${rb.role} on ${rb.scopeType}:${rb.scopeId}`)
        .join(", ");
      lines.push(`**Bindings**: ${bindings}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
