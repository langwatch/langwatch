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
    },
    evaluation: null,
    ...overrides,
  };
}

export function makeContext(
  overrides: Partial<TemplateContext> = {},
): TemplateContext {
  const matches = overrides.matches ?? [makeMatch()];
  const match = overrides.match ?? matches[0] ?? null;
  return {
    trigger: {
      id: "trg_1",
      name: "High latency",
      alertType: "WARNING",
      editUrl:
        "https://app.langwatch.ai/acme/automations?drawer.open=automation&drawer.automationId=trg_1&drawer.source=email-link",
    },
    project: {
      name: "Acme",
      slug: "acme",
      url: "https://app.langwatch.ai/acme",
    },
    digest: { count: matches.length, windowStart: null, windowEnd: null },
    match,
    matches,
    ...overrides,
  };
}
