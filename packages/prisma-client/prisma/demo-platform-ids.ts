/**
 * The demo platform's stable identifiers, value-only — importable by pure
 * generators and unit tests without dragging the generated Prisma client in
 * (prisma/seed-demo-platform.ts needs @prisma/client at runtime; this does not).
 */
export const DEMO_PLATFORM_IDS = {
  agents: {
    support: "demo-agent-support",
    retrieval: "demo-agent-retrieval",
    httpEcho: "demo-agent-http-echo",
  },
  prompt: "demo-prompt-support-copilot",
  promptVersion: "demo-prompt-support-copilot-v1",
  evaluators: {
    quality: "demo-evaluator-quality",
    groundedness: "demo-evaluator-groundedness",
  },
  scenarios: {
    refund: "demo-scenario-refund",
    groundedness: "demo-scenario-groundedness",
    escalation: "demo-scenario-escalation",
  },
  suite: "demo-suite-support-regression",
  dataset: "demo-dataset-support-regression",
  experiment: "demo-experiment-support-quality",
} as const;

/**
 * Config for the demo HTTP agent. httpbin.org's /anything endpoint echoes the
 * request back as JSON, so a scenario run against this agent completes a real
 * network round-trip with no API key: the adapter POSTs `{ messages }` by
 * default, and the JSONPath output picks the echoed last message's content
 * back out as the "reply". Must parse against `httpComponentSchema` — the
 * agent repository re-validates config on every read, so an invalid seed
 * would make the agent unloadable (pinned by a unit test).
 */
export const DEMO_HTTP_AGENT_CONFIG = {
  description: "Echoes the conversation back through httpbin.org.",
  url: "https://httpbin.org/anything/support-copilot",
  method: "POST",
  outputPath: "$.json.messages[-1:].content",
  timeoutMs: 15000,
};

/**
 * Version 1 configData for the demo prompt. Must parse against the prompt
 * feature's latest version schema (same reason as above: read paths validate;
 * pinned by the same unit test). No temperature — the GPT-5 family rejects it.
 */
export const DEMO_PROMPT_CONFIG_DATA = {
  prompt:
    "You are the support copilot for a developer platform. Be concise, answer only from the provided context, and escalate to a human when policy is ambiguous.",
  messages: [],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  model: "openai/gpt-5-mini",
};
