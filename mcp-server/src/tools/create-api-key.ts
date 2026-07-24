import { createApiKey as apiCreateApiKey } from "../langwatch-api-api-keys.js";

export async function handleCreateApiKey(params: {
  keyType: "personal" | "service";
  name: string;
  description?: string;
  expiresAt?: string;
  bindings?: Array<{
    role: "ADMIN" | "MEMBER" | "VIEWER";
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }>;
  projectIds?: string[];
}): Promise<string> {
  const result = await apiCreateApiKey(params);

  const lines: string[] = [];
  lines.push(`API key created successfully!\n`);
  lines.push(`**Name**: ${result.apiKey.name}`);
  lines.push(`**ID**: ${result.apiKey.id}`);
  lines.push(`**Token**: \`${result.token}\``);
  lines.push(`**Created**: ${result.apiKey.createdAt}`);
  lines.push("");
  lines.push(
    "> ⚠️ Save this token now — it will not be shown again.",
  );

  return lines.join("\n");
}
