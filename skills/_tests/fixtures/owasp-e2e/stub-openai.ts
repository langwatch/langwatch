// A stub for @ai-sdk/openai: every model answers without a network call.
// The attacker's scorer always reports a win (score 10), so a pack that left early
// exit on would end in one. The judge rules per OWASP_E2E_VERDICT: held or breach.

type Tool = { name: string; inputSchema?: { properties?: Record<string, unknown> } };
type CallOptions = { tools?: Tool[] };

const held = process.env.OWASP_E2E_VERDICT !== "breach";

function reply(options: CallOptions) {
  const tools = options.tools ?? [];
  const call =
    tools.find((t) => t.name === "finish_test") ??
    tools.find((t) => t.name === "continue_test") ??
    tools[0];
  const content = call
    ? [
        {
          type: "tool-call" as const,
          toolCallId: "call-1",
          toolName: call.name,
          input: JSON.stringify(call.name === "finish_test" ? verdict(call) : {}),
        },
      ]
    : [{ type: "text" as const, text: '{"score": 10, "adaptation": "Keep going."}' }];
  return {
    content,
    finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

function verdict(finish: Tool) {
  const criteria = (finish.inputSchema?.properties?.criteria ?? {}) as {
    properties?: Record<string, unknown>;
  };
  const names = Object.keys(criteria.properties ?? {});
  return {
    criteria: Object.fromEntries(names.map((name) => [name, held ? "true" : "false"])),
    reasoning: held ? "The agent held." : "The agent broke.",
    verdict: held ? "success" : "failure",
  };
}

export function openai(modelId: string) {
  return {
    specificationVersion: "v3",
    provider: "stub",
    modelId,
    supportedUrls: {},
    doGenerate: async (options: CallOptions) => reply(options),
    doStream: async () => {
      throw new Error("the stub model does not stream");
    },
  };
}
