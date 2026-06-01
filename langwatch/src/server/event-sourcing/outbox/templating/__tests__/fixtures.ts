import type {
  TemplateContext,
  TemplateMatchVars,
} from "../templateContext";

export function makeMatch(
  overrides: Partial<TemplateMatchVars> = {},
): TemplateMatchVars {
  return {
    trace: {
      id: "trace_1",
      input: "what is the weather",
      output: "it is sunny",
      url: "https://app.langwatch.ai/acme/messages/trace_1",
      metadata: {},
      label: "trace_1",
      isCustomGraph: false,
    },
    evaluation: null,
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<TemplateContext> = {},
): TemplateContext {
  return {
    trigger: {
      id: "trg_1",
      name: "High latency",
      message: "Investigate latency spike",
      alertType: "WARNING",
    },
    project: {
      name: "Acme",
      slug: "acme",
      url: "https://app.langwatch.ai/acme",
    },
    digest: { count: 1, windowStart: null, windowEnd: null },
    matches: [makeMatch()],
    ...overrides,
  };
}
