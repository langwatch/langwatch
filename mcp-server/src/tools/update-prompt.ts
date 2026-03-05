import {
  updatePrompt as apiUpdatePrompt,
  createPromptVersion as apiCreateVersion,
} from "../langwatch-api.js";
import type { PromptMutationResponse } from "../langwatch-api.js";

/**
 * Handles the platform_update_prompt MCP tool invocation.
 *
 * Updates an existing prompt or creates a new version, depending on the
 * `createVersion` flag. Returns a confirmation with the updated details.
 */
export async function handleUpdatePrompt(params: {
  idOrHandle: string;
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  modelProvider?: string;
  commitMessage?: string;
  createVersion?: boolean;
}): Promise<string> {
  const { idOrHandle, createVersion, ...data } = params;

  let result: PromptMutationResponse;
  if (createVersion) {
    result = await apiCreateVersion(idOrHandle, data);
  } else {
    result = await apiUpdatePrompt(idOrHandle, data);
  }

  const lines: string[] = [];
  lines.push(
    createVersion
      ? "New version created successfully!\n"
      : "Prompt updated successfully!\n"
  );
  if (result.id) lines.push(`**ID**: ${result.id}`);
  if (result.handle) lines.push(`**Handle**: ${result.handle}`);
  if (result.latestVersionNumber != null)
    lines.push(`**Version**: v${result.latestVersionNumber}`);
  if (params.commitMessage)
    lines.push(`**Commit**: ${params.commitMessage}`);

  return lines.join("\n");
}
