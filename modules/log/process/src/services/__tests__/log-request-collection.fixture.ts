import type { LogCorrelationSource, PreparedCanonicalLogRecord } from "@langwatch/log-contract";

const SPRING_AI_PROMPT_SCOPE =
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler";

/** One record as Log's preparation hands it back; a `prompt` makes it a Spring AI prompt log. */
export function preparedLog({
  correlationSource = "wire",
  prompt,
}: {
  correlationSource?: LogCorrelationSource;
  prompt?: string;
}): PreparedCanonicalLogRecord {
  const scopeName = prompt === undefined ? "app.logger" : SPRING_AI_PROMPT_SCOPE;
  const body = prompt === undefined ? "hello" : `Chat Model Prompt Content:\n${prompt}`;
  const correlated = correlationSource !== "none";
  return {
    normalized: { body, attributes: {}, resourceAttributes: {}, scopeName, scopeVersion: null },
    record: {
      tenantId: "project-1",
      organizationId: "organization-1",
      recordId: "a".repeat(64),
      resourceSchemaUrl: "",
      resourceAttributesJson: "{}",
      resourceAttributesFlatJson: "{}",
      resourceAttributeKeys: [],
      resourceDroppedAttributesCount: 0,
      scopeSchemaUrl: "",
      scopeName,
      scopeVersion: "",
      scopeAttributesJson: "{}",
      scopeAttributeKeys: [],
      scopeDroppedAttributesCount: 0,
      wireTraceId: correlated ? "trace-1" : "",
      wireSpanId: correlated ? "span-1" : "",
      correlationTraceId: correlated ? "trace-1" : "",
      correlationSpanId: correlated ? "span-1" : "",
      correlationSource,
      timeUnixNano: "1700000000000000000",
      observedTimeUnixNano: "1700000000000000000",
      timeUnixMs: 1_700_000_000_000,
      severityNumber: 9,
      severityText: "INFO",
      bodyType: "string",
      bodyJson: JSON.stringify(body),
      bodyText: body,
      attributesJson: "{}",
      attributesFlatJson: "{}",
      attributeKeys: [],
      droppedAttributesCount: 0,
      flags: 0,
      eventName: "",
      providerKind: "generic",
      providerEventKind: "",
      providerEventSequence: "",
      providerSessionId: "",
      providerConversationId: "",
      providerPromptId: "",
      piiRedactionLevel: "DISABLED",
      canonicalPayload: "{}",
      canonicalSizeBytes: 2,
      occurredAt: 1_700_000_000_000,
      acceptedAt: 1_700_000_000_500,
    },
  };
}
