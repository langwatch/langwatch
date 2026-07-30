import { describe, expect, it } from "vitest";
import { canonicalizeLogRequest } from "../canonicalize";

/**
 * Behavioural contract: specs/otlp/canonical-log-ingestion.feature. Titles
 * below are copied verbatim from that file's scenarios so `@scenario`
 * annotations bind by exact match (`check-feature-parity.ts` matches on
 * title text alone).
 */

const noRedaction = {
  redactLog: async () => undefined,
};

function request(logRecords: unknown[], scopeName = "test.scope") {
  return {
    resourceLogs: [
      {
        schemaUrl: "resource.schema",
        resource: {
          droppedAttributesCount: 2,
          attributes: [
            { key: "service.name", value: { stringValue: "worker" } },
          ],
        },
        scopeLogs: [
          {
            schemaUrl: "scope.schema",
            scope: {
              name: scopeName,
              version: "1.2.3",
              attributes: [
                { key: "scope.enabled", value: { boolValue: true } },
              ],
            },
            logRecords,
          },
        ],
      },
    ],
  } as any;
}

async function prepare(logRecords: unknown[], scopeName?: string) {
  return canonicalizeLogRequest({
    tenantId: "project_test",
    organizationId: "organization_test",
    request: request(logRecords, scopeName),
    piiRedactionLevel: "DISABLED",
    redactionService: noRedaction,
    acceptedAt: 1_700_000_000_000,
  });
}

describe("canonicalizeLogRequest", () => {
  describe("given a log record with a structured body", () => {
    /** @scenario A structured body keeps its shape */
    it("preserves typed OTLP values and produces a deterministic content id", async () => {
      const log = {
        traceId: "00112233445566778899aabbccddeeff",
        spanId: "0011223344556677",
        timeUnixNano: "1700000000123456789",
        observedTimeUnixNano: "1700000000223456789",
        severityNumber: 13,
        severityText: "WARN",
        body: {
          kvlistValue: {
            values: [
              { key: "answer", value: { intValue: "9223372036854775807" } },
              { key: "ok", value: { boolValue: true } },
            ],
          },
        },
        attributes: [
          {
            key: "nested",
            value: {
              arrayValue: {
                values: [
                  { doubleValue: 1.5 },
                  { bytesValue: new Uint8Array([1, 2, 3]) },
                ],
              },
            },
          },
        ],
      };
      const first = await prepare([log]);
      const second = await prepare([structuredClone(log)]);

      expect(first.rejectedLogRecords).toBe(0);
      expect(first.accepted[0]!.record).toMatchObject({
        bodyType: "kvlist",
        correlationSource: "wire",
        wireTraceId: log.traceId,
        correlationTraceId: log.traceId,
        timeUnixNano: log.timeUnixNano,
      });
      // "Then it is not flattened to a plain string"
      expect(first.accepted[0]!.record.bodyText).toBeNull();
      // Redelivery of the same wire record produces the same content id.
      expect(first.accepted[0]!.record.recordId).toBe(
        second.accepted[0]!.record.recordId,
      );
      expect(JSON.parse(first.accepted[0]!.record.bodyJson)).toEqual({
        type: "kvlist",
        value: [
          {
            key: "answer",
            value: { type: "int", value: "9223372036854775807" },
          },
          { key: "ok", value: { type: "bool", value: true } },
        ],
      });
    });
  });

  describe("given resource, scope and record attributes sharing a key name", () => {
    /** @scenario Attribute scopes stay distinct */
    it("keeps each attribute scope separately readable", async () => {
      const result = await canonicalizeLogRequest({
        tenantId: "project_test",
        organizationId: "organization_test",
        piiRedactionLevel: "DISABLED",
        redactionService: noRedaction,
        acceptedAt: 1_700_000_000_000,
        request: {
          resourceLogs: [
            {
              resource: {
                attributes: [
                  { key: "shared", value: { stringValue: "resource-value" } },
                ],
              },
              scopeLogs: [
                {
                  scope: {
                    name: "scope",
                    attributes: [
                      { key: "shared", value: { stringValue: "scope-value" } },
                    ],
                  },
                  logRecords: [
                    {
                      body: { stringValue: "x" },
                      attributes: [
                        {
                          key: "shared",
                          value: { stringValue: "record-value" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        } as any,
      });

      const { record } = result.accepted[0]!;
      expect(record.resourceAttributesJson).toContain("resource-value");
      expect(record.scopeAttributesJson).toContain("scope-value");
      expect(record.attributesJson).toContain("record-value");
      expect(record.resourceAttributesJson).not.toContain("scope-value");
      expect(record.resourceAttributesJson).not.toContain("record-value");
      expect(record.scopeAttributesJson).not.toContain("record-value");
    });
  });

  describe("given a log record with a severity number and text", () => {
    /** @scenario Severity keeps both its number and its text */
    it("reports both the severity number and the severity text", async () => {
      const result = await prepare([
        {
          severityNumber: 17,
          severityText: "ERROR",
          body: { stringValue: "x" },
        },
      ]);
      expect(result.accepted[0]!.record).toMatchObject({
        severityNumber: 17,
        severityText: "ERROR",
      });
    });
  });

  describe("given nested string values that must be redacted", () => {
    it("redacts them before hashing or storage", async () => {
      const result = await canonicalizeLogRequest({
        tenantId: "project_test",
        organizationId: "organization_test",
        request: request([
          {
            body: {
              kvlistValue: {
                values: [
                  {
                    key: "email",
                    value: { stringValue: "person@example.com" },
                  },
                ],
              },
            },
          },
        ]),
        piiRedactionLevel: "STRICT",
        redactionService: {
          redactLog: async (log) => {
            for (const key of Object.keys(log.attributes)) {
              log.attributes[key] = "[REDACTED]";
            }
          },
        },
        acceptedAt: 1_700_000_000_000,
      });

      expect(result.accepted[0]!.record.canonicalPayload).not.toContain(
        "person@example.com",
      );
      expect(result.accepted[0]!.record.canonicalPayload).toContain(
        "[REDACTED]",
      );
    });
  });

  describe("given a coding-agent record correlating to a known span", () => {
    /** @scenario Coding agent logs enrich their trace */
    it("makes correlation detail available on the record for the trace bridge to read", async () => {
      const result = await prepare(
        [
          {
            timeUnixNano: "1700000000000000000",
            body: { stringValue: "event" },
            attributes: [
              { key: "event.name", value: { stringValue: "api_request" } },
              { key: "event.sequence", value: { intValue: "4" } },
              { key: "session.id", value: { stringValue: "session-1" } },
              { key: "prompt.id", value: { stringValue: "prompt-2" } },
            ],
          },
        ],
        "com.anthropic.claude_code.events",
      );
      const record = result.accepted[0]!.record;
      expect(record).toMatchObject({
        wireTraceId: "",
        wireSpanId: "",
        correlationSource: "claude_synthesized",
        providerKind: "claude_code",
        providerEventKind: "",
      });
      expect(record.correlationTraceId).toMatch(/^[a-f0-9]{32}$/);
      expect(record.correlationSpanId).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe("given a log record correlating to a span the platform cannot resolve", () => {
    /** @scenario A record that cannot be tied to a trace is still accepted */
    it("still accepts the record", async () => {
      const result = await prepare([
        { body: { stringValue: "no correlation possible" } },
      ]);
      expect(result.rejectedLogRecords).toBe(0);
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]!.record.correlationSource).toBe("none");
    });
  });

  describe("given a codex event name with no wire trace/span id", () => {
    it("uses the OTLP eventName field for provider correlation when the attribute is absent", async () => {
      const result = await prepare([
        {
          eventName: "codex.user_prompt",
          body: { stringValue: "event" },
          attributes: [
            {
              key: "conversation.id",
              value: { stringValue: "conversation-1" },
            },
          ],
        },
      ]);
      expect(result.accepted[0]!.record).toMatchObject({
        eventName: "codex.user_prompt",
        providerKind: "codex",
        correlationSource: "codex_synthesized",
      });
      expect(result.accepted[0]!.normalized.attributes["event.name"]).toBe(
        "codex.user_prompt",
      );
    });
  });

  describe("given a batch containing a malformed record alongside valid ones", () => {
    /** @scenario Only the sender's own malformed records count as rejected */
    it("reports only the malformed records as rejected, and accepts the rest", async () => {
      const result = await prepare([
        { body: { stringValue: "accepted" } },
        { body: { stringValue: "bad", boolValue: true } },
        { body: { stringValue: "x".repeat(1_100_000) } },
      ]);
      expect(result.accepted).toHaveLength(1);
      expect(result.rejectedLogRecords).toBe(2);
      expect(result.errors.join(" ")).toContain("multiple values");
      expect(result.errors.join(" ")).toContain("maximum");
    });
  });

  describe("given a record with an invalid unsigned counter", () => {
    it("rejects it instead of coercing the value", async () => {
      const result = await prepare([
        { body: { stringValue: "bad" }, droppedAttributesCount: -1 },
      ]);
      expect(result.accepted).toHaveLength(0);
      expect(result.rejectedLogRecords).toBe(1);
    });
  });

  describe("given a batch of log records already accepted once", () => {
    /** @scenario The same batch sent twice is stored once */
    it("produces the same set of record ids on a redelivery", async () => {
      const log = {
        body: { stringValue: "redelivered" },
        timeUnixNano: "1700000000000000000",
      };
      const first = await prepare([log]);
      const second = await prepare([structuredClone(log)]);
      expect(first.accepted[0]!.record.recordId).toBe(
        second.accepted[0]!.record.recordId,
      );
    });

    /** @scenario The same batch sent twice is stored once */
    it("derives the same TimeUnixMs on a redelivery of a record carrying no timestamp", async () => {
      // TimeUnixMs is in the deployed sort key, so a redelivery deriving a
      // different one writes a second row for the same RecordId and bills the
      // tenant twice. Every input to it has to be inside the hashed payload —
      // and the record's own arrival time is not.
      const log = { body: { stringValue: "no timestamps at all" } };
      const first = await canonicalizeLogRequest({
        tenantId: "project_test",
        organizationId: "organization_test",
        request: request([log]),
        piiRedactionLevel: "DISABLED",
        redactionService: noRedaction,
        acceptedAt: 1_700_000_000_000,
      });
      const second = await canonicalizeLogRequest({
        tenantId: "project_test",
        organizationId: "organization_test",
        request: request([structuredClone(log)]),
        piiRedactionLevel: "DISABLED",
        redactionService: noRedaction,
        acceptedAt: 1_700_000_999_999,
      });

      expect(first.accepted[0]!.record.recordId).toBe(
        second.accepted[0]!.record.recordId,
      );
      expect(first.accepted[0]!.record.timeUnixMs).toBe(
        second.accepted[0]!.record.timeUnixMs,
      );
      expect(first.accepted[0]!.record.occurredAt).toBe(
        second.accepted[0]!.record.occurredAt,
      );
    });
  });
});
