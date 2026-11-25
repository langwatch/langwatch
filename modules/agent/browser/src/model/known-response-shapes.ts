/** A sample of the OpenAI chat completions response; arrays stand for every index. */
const OPENAI_CHAT_COMPLETION = {
  id: "",
  object: "",
  created: 0,
  model: "",
  choices: [{ index: 0, message: { role: "", content: "" }, finish_reason: "" }],
  usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
};

/** The response shape a URL is known to return, when we recognise it. */
export function knownResponseShape({ url }: { url: string | undefined }): unknown {
  return url?.includes("/chat/completions") ? OPENAI_CHAT_COMPLETION : undefined;
}

/** Parses a test response body; strings that are JSON count as their parsed value. */
export function responseShape({ response }: { response: unknown }): unknown {
  if (typeof response !== "string") return response;
  try {
    return JSON.parse(response);
  } catch {
    return undefined;
  }
}
