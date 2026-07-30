import { describe, expect, it } from "vitest";
import { recordCanonicalLog } from "../recordCanonicalLog.command";
import { canonicalLogRecordSchema } from "../schema";

function fixtureRecord() {
  return canonicalLogRecordSchema.parse({
    tenantId: "project_test",
    organizationId: "organization_test",
    recordId: "a".repeat(64),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: "{}",
    resourceAttributeKeys: [],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "",
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "",
    correlationSpanId: "",
    correlationSource: "none",
    timeUnixNano: "0",
    observedTimeUnixNano: "0",
    timeUnixMs: 0,
    severityNumber: 0,
    severityText: "",
    bodyType: "string",
    bodyJson: "{}",
    bodyText: "hello",
    attributesJson: "[]",
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
    occurredAt: 0,
    acceptedAt: 0,
  });
}

describe("the recordCanonicalLog command", () => {
  describe("given the recordCanonicalLog command", () => {
    it("emits exactly the recordReceived event, carrying the input through unchanged", async () => {
      const record = fixtureRecord();
      const emitted = await recordCanonicalLog(record);
      expect(emitted).toEqual([{ type: "recordReceived", data: record }]);
    });
  });
});
