type PromptMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Moves a stored system message into the `prompt` field, since
 * `createPrompt`/`updatePrompt` reject input carrying both
 * (`SystemPromptConflictError`). The system message wins when both are present.
 */
export function hoistSystemMessage(source: {
  prompt?: string | null;
  messages?: PromptMessage[] | null;
}): {
  prompt: string | undefined;
  messages: PromptMessage[] | undefined;
} {
  const systemMessage = source.messages?.find((msg) => msg.role === "system");
  const nonSystemMessages = source.messages?.filter((msg) => msg.role !== "system");

  return {
    prompt: systemMessage ? systemMessage.content : (source.prompt ?? undefined),
    messages: nonSystemMessages?.length ? nonSystemMessages : undefined,
  };
}
