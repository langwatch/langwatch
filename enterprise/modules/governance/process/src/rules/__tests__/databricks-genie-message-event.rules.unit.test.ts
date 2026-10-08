import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  conversationsPageSchema,
  genieIdentityFromScimUser,
  messageEvent,
  messagesPageSchema,
  scimUserSchema,
} from "../../features/databricks-genie/rules/databricks-genie-message-event.rules.ts";
import {
  conversationWalkPlan,
  earlierOf,
  genieEpochMs,
  spaceWalkPlan,
} from "../../features/databricks-genie/rules/databricks-genie-sweep.rules.ts";

const message = messagesPageSchema.parse({
  messages: [
    {
      message_id: "m1",
      conversation_id: "c1",
      space_id: "sp1",
      user_id: 42,
      content: "How much did we sell?",
      status: "COMPLETED",
      created_timestamp: 1_767_261_600,
      attachments: [
        {
          attachment_id: "at1",
          query: {
            query: "SELECT 1",
            statement_id: "st1",
            query_result_metadata: { row_count: 3 },
          },
        },
      ],
    },
  ],
}).messages[0]!;
const conversation = conversationsPageSchema.parse({
  conversations: [{ conversation_id: "c1", title: "Q1" }],
}).conversations[0]!;
const identity = genieIdentityFromScimUser(
  scimUserSchema.parse({ userName: "ann@example.test", externalId: "oid-1", displayName: "Ann" }),
  42,
);

describe("genieIdentityFromScimUser()", () => {
  it("keys on the directory object id, then the login, then the numeric id", () => {
    expect(identity).toEqual({
      key: "oid-1",
      email: "ann@example.test",
      externalId: "oid-1",
      displayName: "Ann",
    });
    expect(
      genieIdentityFromScimUser(scimUserSchema.parse({ userName: "bo@example.test" }), 7).key,
    ).toBe("bo@example.test");
    expect(genieIdentityFromScimUser(scimUserSchema.parse({}), 7).key).toBe("7");
  });
});

describe("messageEvent()", () => {
  it("records the question, its SQL and its author on the message's own coordinates", () => {
    const event = messageEvent({
      message,
      space: { space_id: "sp1", title: "Revenue" },
      conversation,
      createdMs: Date.UTC(2026, 0, 1, 10),
      identity,
    });

    expect(event).not.toHaveProperty("cost_usd");
    expect(JSON.parse(event.raw_payload ?? "")).toEqual(JSON.parse(JSON.stringify(message)));
    expect({ ...event, raw_payload: undefined }).toEqual({
      source_event_id: "m1",
      event_timestamp: "2026-01-01T10:00:00.000Z",
      actor: "ann@example.test",
      action: "genie_query",
      target: "Revenue",
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: undefined,
      extra: {
        spaceId: "sp1",
        spaceTitle: "Revenue",
        conversationId: "c1",
        conversationTitle: "Q1",
        messageId: "m1",
        status: "COMPLETED",
        question: "How much did we sell?",
        generatedSql: "SELECT 1",
        statementId: "st1",
        rowCount: 3,
        actorKey: "oid-1",
        actorEmail: "ann@example.test",
        actorExternalId: "oid-1",
        actorDisplayName: "Ann",
        actorUserId: "42",
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          costStatus: "estimate",
          dimensions: { spaceId: "sp1", conversationId: "c1", messageId: "m1" },
          agentId: "sp1",
          model: "databricks/genie",
        },
      },
    });
  });
});

describe("the sweep's plans", () => {
  const spaces = {
    items: [
      { space_id: "b", title: null },
      { space_id: "a", title: "A" },
    ],
    complete: true,
  };

  it("orders spaces by id, fingerprints the set and resumes only into the same set", () => {
    const plan = spaceWalkPlan({ spaces, resumeSpaceId: "b", resumeFingerprint: null });
    const changed = spaceWalkPlan({ spaces, resumeSpaceId: "b", resumeFingerprint: "other" });

    expect(plan.ordered.map((s) => s.space_id)).toEqual(["a", "b"]);
    expect(plan).toMatchObject({ startAt: 1, resumable: true, fingerprint: "a\u0000b" });
    expect(changed).toMatchObject({ startAt: 0, resumable: false });
  });

  it("restarts a space whose conversation listing was cut short", () => {
    const plan = conversationWalkPlan({
      conversations: { items: [conversation], complete: false },
      resumeConversationId: "c1",
    });

    expect(plan).toMatchObject({ startAt: 0, resumable: false });
  });

  it("reads Databricks timestamps in either unit and keeps the earlier ceiling", () => {
    expect(genieEpochMs(1_719_769_718)).toBe(1_719_769_718_000);
    expect(genieEpochMs(1_719_769_718_000)).toBe(1_719_769_718_000);
    expect(earlierOf(null, 5)).toBe(5);
    expect(earlierOf(3, 5)).toBe(3);
  });
});
