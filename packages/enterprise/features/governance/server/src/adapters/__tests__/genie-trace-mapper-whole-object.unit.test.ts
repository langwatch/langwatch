// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The gate for splitting this mapper (ADR-088 Decision 26, commit order rung 1).
 *
 * The split's stated gate is "byte-identical output", and the existing suite
 * cannot see it: of the seven `databricks.genie.*` attributes the mapper
 * emits, only `statement_ids` and `viz_query_attachment_ids` are ever
 * asserted. A refactor could drop `space_id`, reorder attributes, or change
 * a span's parent and every test would still pass.
 *
 * So this file asserts the whole mapped object, not selected fields. It is
 * deliberately unreadable as documentation — the other test file is where
 * behaviour is explained. This one exists to fail when *anything* moves,
 * which is exactly what a refactor gate is for.
 *
 * If a change to this snapshot is intended, the diff must be read line by
 * line before it is accepted. An updated snapshot nobody read is the same as
 * no gate at all.
 */

import { describe, expect, it } from "vitest";
import { GENIE_ROUTING_PROFILE, GenieTraceMapper } from "../genie-trace-mapper.adapter";
import type { NormalizedPullEvent } from "@langwatch/enterprise-governance-contract";

const ORIGIN = {
  ingestionSourceId: "source-1",
  organizationId: "org-1",
  sourceType: "databricks_genie",
  profile: GENIE_ROUTING_PROFILE,
};

function genieEvent(
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): NormalizedPullEvent {
  return {
    source_event_id: String(message.message_id ?? "msg-1"),
    event_timestamp: "2026-08-20T10:00:00.000Z",
    actor: "analyst@acme.example",
    action: "genie_query",
    target: "Sales space",
    cost_usd: "0",
    tokens_input: 0,
    tokens_output: 0,
    raw_payload: JSON.stringify(message),
    extra: {
      conversationId: "conv-1",
      messageId: String(message.message_id ?? "msg-1"),
      ...extra,
    },
  };
}

/**
 * The capture's shape, carrying every branch the mapper has: an answer
 * attachment, a query attachment with all four thought types, the dropped
 * suggested-questions attachment, and a viz pointer. A fixture missing any
 * of these leaves that branch ungated.
 */
function completedMessage(overrides: Record<string, unknown> = {}) {
  return {
    message_id: "msg-1",
    conversation_id: "conv-1",
    user_id: 90210,
    content: "Which region sold most in Q2?",
    status: "COMPLETED",
    created_timestamp: 1755684000,
    attachments: [
      {
        attachment_id: "att-q1",
        query: {
          query: "SELECT region, SUM(amount) FROM sales GROUP BY region",
          description: "Total sales by region",
          statement_id: "stmt-1",
          query_result_metadata: { row_count: 4 },
          thoughts: [
            {
              thought_type: "THOUGHT_TYPE_DESCRIPTION",
              content: "Total sales by region",
            },
            {
              thought_type: "THOUGHT_TYPE_STEPS",
              content: "Group by region, sum amount",
            },
            {
              thought_type: "THOUGHT_TYPE_UNDERSTANDING",
              content: "User wants regional totals",
            },
            {
              thought_type: "THOUGHT_TYPE_DATA_SOURCING",
              content: "Use the sales table",
            },
          ],
        },
      },
      {
        attachment_id: "att-a1",
        text: {
          content: "EMEA sold the most in Q2.",
          purpose: "TEXT_ATTACHMENT_PURPOSE_ANSWER",
        },
      },
      { attachment_id: "att-s1", suggested_questions: ["What about Q3?"] },
      { attachment_id: "att-v1", viz: { query_attachment_id: "att-q1" } },
    ],
    ...overrides,
  };
}

describe("when the event names the space the question was asked in", () => {
  // `space_id` is the one provider attribute sourced from the adapter's extra
  // fields rather than the payload, so a fixture that omits `spaceId` leaves
  // it out of every other snapshot here. Without this case the split could
  // drop it silently — which is how it went unasserted in the first place.
  it("produces this exact request, attribute for attribute", () => {
    expect(
      GenieTraceMapper.toTraceRequest({
        events: [genieEvent(completedMessage(), { spaceId: "space-7" })],
        origin: ORIGIN,
      }),
    ).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [],
              "droppedAttributesCount": 0,
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "langwatch.ingestion.databricks_genie",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "llm",
                        },
                      },
                      {
                        "key": "langwatch.thread.id",
                        "value": {
                          "stringValue": "source-1:conv-1",
                        },
                      },
                      {
                        "key": "langwatch.input",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"user","content":"Which region sold most in Q2?"}]}",
                        },
                      },
                      {
                        "key": "langwatch.output",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"assistant","content":"EMEA sold the most in Q2.","reasoning_content":"User wants regional totals\\n\\nUse the sales table\\n\\nGroup by region, sum amount"}]}",
                        },
                      },
                      {
                        "key": "gen_ai.request.model",
                        "value": {
                          "stringValue": "databricks/genie",
                        },
                      },
                      {
                        "key": "databricks.genie.message_id",
                        "value": {
                          "stringValue": "msg-1",
                        },
                      },
                      {
                        "key": "databricks.genie.conversation_id",
                        "value": {
                          "stringValue": "conv-1",
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.user.id",
                        "value": {
                          "stringValue": "90210",
                        },
                      },
                      {
                        "key": "databricks.genie.status",
                        "value": {
                          "stringValue": "COMPLETED",
                        },
                      },
                      {
                        "key": "databricks.genie.space_id",
                        "value": {
                          "stringValue": "space-7",
                        },
                      },
                      {
                        "key": "databricks.genie.statement_ids",
                        "value": {
                          "stringValue": "["stmt-1"]",
                        },
                      },
                      {
                        "key": "databricks.genie.viz_query_attachment_ids",
                        "value": {
                          "stringValue": "["att-q1"]",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.message",
                    "spanId": "0d4a72c6fc11176c",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "tool",
                        },
                      },
                      {
                        "key": "tool_name",
                        "value": {
                          "stringValue": "Total sales by region",
                        },
                      },
                      {
                        "key": "full_command",
                        "value": {
                          "stringValue": "SELECT region, SUM(amount) FROM sales GROUP BY region",
                        },
                      },
                      {
                        "key": "statement_id",
                        "value": {
                          "stringValue": "stmt-1",
                        },
                      },
                      {
                        "key": "row_count",
                        "value": {
                          "intValue": 4,
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.query",
                    "parentSpanId": "0d4a72c6fc11176c",
                    "spanId": "8e7beeabe3c2eea3",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });
});

describe("when the Genie mapper runs over the capture shape", () => {
  it("produces this exact request, attribute for attribute", () => {
    expect(
      GenieTraceMapper.toTraceRequest({
        events: [genieEvent(completedMessage())],
        origin: ORIGIN,
      }),
    ).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [],
              "droppedAttributesCount": 0,
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "langwatch.ingestion.databricks_genie",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "llm",
                        },
                      },
                      {
                        "key": "langwatch.thread.id",
                        "value": {
                          "stringValue": "source-1:conv-1",
                        },
                      },
                      {
                        "key": "langwatch.input",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"user","content":"Which region sold most in Q2?"}]}",
                        },
                      },
                      {
                        "key": "langwatch.output",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"assistant","content":"EMEA sold the most in Q2.","reasoning_content":"User wants regional totals\\n\\nUse the sales table\\n\\nGroup by region, sum amount"}]}",
                        },
                      },
                      {
                        "key": "gen_ai.request.model",
                        "value": {
                          "stringValue": "databricks/genie",
                        },
                      },
                      {
                        "key": "databricks.genie.message_id",
                        "value": {
                          "stringValue": "msg-1",
                        },
                      },
                      {
                        "key": "databricks.genie.conversation_id",
                        "value": {
                          "stringValue": "conv-1",
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.user.id",
                        "value": {
                          "stringValue": "90210",
                        },
                      },
                      {
                        "key": "databricks.genie.status",
                        "value": {
                          "stringValue": "COMPLETED",
                        },
                      },
                      {
                        "key": "databricks.genie.statement_ids",
                        "value": {
                          "stringValue": "["stmt-1"]",
                        },
                      },
                      {
                        "key": "databricks.genie.viz_query_attachment_ids",
                        "value": {
                          "stringValue": "["att-q1"]",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.message",
                    "spanId": "0d4a72c6fc11176c",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "tool",
                        },
                      },
                      {
                        "key": "tool_name",
                        "value": {
                          "stringValue": "Total sales by region",
                        },
                      },
                      {
                        "key": "full_command",
                        "value": {
                          "stringValue": "SELECT region, SUM(amount) FROM sales GROUP BY region",
                        },
                      },
                      {
                        "key": "statement_id",
                        "value": {
                          "stringValue": "stmt-1",
                        },
                      },
                      {
                        "key": "row_count",
                        "value": {
                          "intValue": 4,
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.query",
                    "parentSpanId": "0d4a72c6fc11176c",
                    "spanId": "8e7beeabe3c2eea3",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });
});

describe("when a Genie message failed", () => {
  it("produces this exact request, attribute for attribute", () => {
    expect(
      GenieTraceMapper.toTraceRequest({
        events: [
          genieEvent(
            completedMessage({
              message_id: "msg-fail",
              status: "FAILED",
              attachments: [],
            }),
          ),
        ],
        origin: ORIGIN,
      }),
    ).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [],
              "droppedAttributesCount": 0,
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "langwatch.ingestion.databricks_genie",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "llm",
                        },
                      },
                      {
                        "key": "langwatch.thread.id",
                        "value": {
                          "stringValue": "source-1:conv-1",
                        },
                      },
                      {
                        "key": "langwatch.input",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"user","content":"Which region sold most in Q2?"}]}",
                        },
                      },
                      {
                        "key": "langwatch.output",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"assistant","content":"[Genie message FAILED — no answer recorded]"}]}",
                        },
                      },
                      {
                        "key": "gen_ai.request.model",
                        "value": {
                          "stringValue": "databricks/genie",
                        },
                      },
                      {
                        "key": "databricks.genie.message_id",
                        "value": {
                          "stringValue": "msg-fail",
                        },
                      },
                      {
                        "key": "databricks.genie.conversation_id",
                        "value": {
                          "stringValue": "conv-1",
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.user.id",
                        "value": {
                          "stringValue": "90210",
                        },
                      },
                      {
                        "key": "databricks.genie.status",
                        "value": {
                          "stringValue": "FAILED",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.message",
                    "spanId": "62f9b05d000c657e",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 2,
                      "message": "FAILED",
                    },
                    "traceId": "9495ac3a16177bc4971257887da6c98e",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });
});

describe("when a Genie answer was regenerated", () => {
  it("produces this exact request, attribute for attribute", () => {
    expect(
      GenieTraceMapper.toTraceRequest({
        events: [genieEvent(completedMessage({ auto_regenerate_count: 2 }))],
        origin: ORIGIN,
      }),
    ).toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [],
              "droppedAttributesCount": 0,
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "langwatch.ingestion.databricks_genie",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "llm",
                        },
                      },
                      {
                        "key": "langwatch.thread.id",
                        "value": {
                          "stringValue": "source-1:conv-1",
                        },
                      },
                      {
                        "key": "langwatch.input",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"user","content":"Which region sold most in Q2?"}]}",
                        },
                      },
                      {
                        "key": "langwatch.output",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"assistant","content":"EMEA sold the most in Q2.","reasoning_content":"User wants regional totals\\n\\nUse the sales table\\n\\nGroup by region, sum amount"}]}",
                        },
                      },
                      {
                        "key": "gen_ai.request.model",
                        "value": {
                          "stringValue": "databricks/genie",
                        },
                      },
                      {
                        "key": "databricks.genie.message_id",
                        "value": {
                          "stringValue": "msg-1",
                        },
                      },
                      {
                        "key": "databricks.genie.conversation_id",
                        "value": {
                          "stringValue": "conv-1",
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.user.id",
                        "value": {
                          "stringValue": "90210",
                        },
                      },
                      {
                        "key": "databricks.genie.status",
                        "value": {
                          "stringValue": "COMPLETED",
                        },
                      },
                      {
                        "key": "databricks.genie.auto_regenerate_count",
                        "value": {
                          "intValue": 2,
                        },
                      },
                      {
                        "key": "databricks.genie.statement_ids",
                        "value": {
                          "stringValue": "["stmt-1"]",
                        },
                      },
                      {
                        "key": "databricks.genie.viz_query_attachment_ids",
                        "value": {
                          "stringValue": "["att-q1"]",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.message",
                    "spanId": "04f2f84b19b7e6c1",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "tool",
                        },
                      },
                      {
                        "key": "tool_name",
                        "value": {
                          "stringValue": "Total sales by region",
                        },
                      },
                      {
                        "key": "full_command",
                        "value": {
                          "stringValue": "SELECT region, SUM(amount) FROM sales GROUP BY region",
                        },
                      },
                      {
                        "key": "statement_id",
                        "value": {
                          "stringValue": "stmt-1",
                        },
                      },
                      {
                        "key": "row_count",
                        "value": {
                          "intValue": 4,
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1755684000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.query",
                    "parentSpanId": "04f2f84b19b7e6c1",
                    "spanId": "ac578f1829a57986",
                    "startTimeUnixNano": "1755684000000000000",
                    "status": {
                      "code": 1,
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });
});

describe("when the payload does not parse", () => {
  it("produces this exact request, attribute for attribute", () => {
    const broken: NormalizedPullEvent = {
      ...genieEvent(completedMessage()),
      raw_payload: "{not json",
      extra: {
        conversationId: "conv-1",
        messageId: "msg-1",
        question: "What was pulled?",
      },
    };
    expect(GenieTraceMapper.toTraceRequest({ events: [broken], origin: ORIGIN }))
      .toMatchInlineSnapshot(`
      {
        "resourceSpans": [
          {
            "resource": {
              "attributes": [],
              "droppedAttributesCount": 0,
            },
            "scopeSpans": [
              {
                "scope": {
                  "name": "langwatch.ingestion.databricks_genie",
                },
                "spans": [
                  {
                    "attributes": [
                      {
                        "key": "langwatch.span.type",
                        "value": {
                          "stringValue": "llm",
                        },
                      },
                      {
                        "key": "langwatch.thread.id",
                        "value": {
                          "stringValue": "source-1:conv-1",
                        },
                      },
                      {
                        "key": "langwatch.input",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"user","content":"What was pulled?"}]}",
                        },
                      },
                      {
                        "key": "langwatch.output",
                        "value": {
                          "stringValue": "{"type":"chat_messages","value":[{"role":"assistant","content":"[Genie message UNKNOWN_STATUS — no answer recorded]"}]}",
                        },
                      },
                      {
                        "key": "gen_ai.request.model",
                        "value": {
                          "stringValue": "databricks/genie",
                        },
                      },
                      {
                        "key": "databricks.genie.message_id",
                        "value": {
                          "stringValue": "msg-1",
                        },
                      },
                      {
                        "key": "databricks.genie.conversation_id",
                        "value": {
                          "stringValue": "conv-1",
                        },
                      },
                      {
                        "key": "langwatch.origin.kind",
                        "value": {
                          "stringValue": "ingestion_source",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.id",
                        "value": {
                          "stringValue": "source-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.organization_id",
                        "value": {
                          "stringValue": "org-1",
                        },
                      },
                      {
                        "key": "langwatch.ingestion_source.source_type",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                      {
                        "key": "langwatch.source",
                        "value": {
                          "stringValue": "databricks_genie",
                        },
                      },
                    ],
                    "endTimeUnixNano": "1787220000000000000",
                    "kind": "SPAN_KIND_INTERNAL",
                    "name": "databricks_genie.message",
                    "spanId": "0d4a72c6fc11176c",
                    "startTimeUnixNano": "1787220000000000000",
                    "status": {
                      "code": 2,
                      "message": "unknown",
                    },
                    "traceId": "f184ba138659952f1c76c63ffd414170",
                  },
                ],
              },
            ],
          },
        ],
      }
    `);
  });
});
