/** Shape rules the prompt services share: the "latest" tag, and system-message normalization. */

/** Prepends the built-in "latest" tag when the current version is the latest for its prompt. */
export function withLatestTag(params: {
  tags: Array<{ name: string; versionId: string }>;
  currentVersionId: string;
  latestVersionId: string;
}): Array<{ name: string; versionId: string }> {
  if (!params.currentVersionId || params.currentVersionId !== params.latestVersionId) {
    return params.tags;
  }

  return [{ name: "latest", versionId: params.latestVersionId }, ...params.tags];
}

/** System content lives in `prompt`, and is removed from `messages`. */
export function normalizeSystemMessage(data: {
  prompt?: string;
  messages?: Array<{ role: string; content: string }> | undefined;
}): { prompt?: string; messages?: Array<{ role: string; content: string }> } {
  const messageSystemPrompt = data.messages?.find((msg) => msg.role === "system")?.content;
  const normalized: {
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
  } = { ...data };
  if (messageSystemPrompt) {
    normalized.prompt = normalized.prompt ?? messageSystemPrompt;
    normalized.messages = (normalized.messages ?? []).filter((msg) => msg.role !== "system");
  }

  return normalized;
}
