/**
 * @vitest-environment node
 *
 * Unit tests for the scenario message WIRE contract — which message shapes
 * `scenarioMessageSnapshotSchema` accepts, and which fields survive validation.
 *
 * Two dialects reach the same endpoint. The scenario SDK speaks AG-UI's
 * (`toolCalls`, `toolCallId`, plus `activity` and `reasoning` roles); OpenAI
 * clients and langwatch's own `chatMessageSchema` speak snake_case. The message
 * union accepts both.
 *
 * These assert on the PARSED OUTPUT, not merely on success, because the union
 * members are Zod objects and Zod strips keys no member declares. A field that
 * vanishes does so silently — no error, no 400, just missing data in the
 * transcript — so "accepted" and "preserved" are separate claims and both are
 * pinned here.
 *
 * Written to pin behaviour BEFORE the `@ag-ui/core` message schemas were
 * vendored into `agent-message-schemas.ts`, so the vendored copy is held to
 * what the package actually did rather than to a reading of it.
 *
 * @see specs/scenarios/scenario-message-wire-contract.feature
 */
import { describe, expect, it } from "vitest";
import { ScenarioEventType } from "~/server/scenarios/scenario-event.enums";
import { scenarioMessageSnapshotSchema } from "~/server/scenarios/schemas";

/** A MESSAGE_SNAPSHOT wire event carrying the given messages. */
function makeSnapshot(messages: unknown[]) {
  return {
    type: ScenarioEventType.MESSAGE_SNAPSHOT,
    timestamp: 1_700_000_000_000,
    batchRunId: "batch-1",
    scenarioId: "scenario-1",
    scenarioRunId: "run-1",
    scenarioSetId: "default",
    messages,
  };
}

/**
 * Parses a snapshot and returns its single validated message.
 *
 * Every caller asserts on the message's surviving fields, so a rejection here
 * would otherwise surface as a confusing `undefined` field mismatch rather than
 * as the parse failure it is.
 */
function parseOneMessage(message: unknown): Record<string, unknown> {
  const result = scenarioMessageSnapshotSchema.safeParse(
    makeSnapshot([message]),
  );
  // biome-ignore lint/suspicious/noMisplacedAssertion: acceptance is the shared precondition for every preservation assertion below
  expect(result.success).toBe(true);
  if (!result.success) throw result.error;
  return result.data.messages[0] as unknown as Record<string, unknown>;
}

describe("given an agent emitting messages in the AG-UI dialect", () => {
  describe("when an assistant turn requests tools with the camelCase spelling", () => {
    /** @scenario "An assistant turn requesting tools keeps its tool calls" */
    it("accepts the snapshot and preserves the tool calls", () => {
      const parsed = parseOneMessage({
        id: "msg-1",
        role: "assistant",
        content: "let me look that up",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "search", arguments: '{"q":"weather"}' },
          },
        ],
      });

      expect(parsed.toolCalls).toEqual([
        {
          id: "call-1",
          type: "function",
          function: { name: "search", arguments: '{"q":"weather"}' },
        },
      ]);
    });
  });

  describe("when a tool result carries the camelCase call identifier", () => {
    /** @scenario "A tool result keeps the identifier that pairs it with its call" */
    it("accepts the snapshot and preserves the identifier", () => {
      const parsed = parseOneMessage({
        id: "msg-2",
        role: "tool",
        content: "22 degrees and clear",
        toolCallId: "call-1",
      });

      expect(parsed.toolCallId).toBe("call-1");
      expect(parsed.content).toBe("22 degrees and clear");
    });
  });

  describe("when the agent reports an activity", () => {
    /** @scenario "An activity turn is accepted" */
    it("accepts the snapshot and preserves the activity type and content", () => {
      const parsed = parseOneMessage({
        id: "msg-3",
        role: "activity",
        activityType: "web_search",
        content: { query: "weather", results: 3 },
      });

      expect(parsed.activityType).toBe("web_search");
      expect(parsed.content).toEqual({ query: "weather", results: 3 });
    });
  });

  describe("when the agent emits its reasoning", () => {
    /** @scenario "A reasoning turn is accepted" */
    it("accepts the snapshot and preserves the reasoning content", () => {
      const parsed = parseOneMessage({
        id: "msg-4",
        role: "reasoning",
        content: "The user asked about weather, so I should search.",
      });

      expect(parsed.role).toBe("reasoning");
      expect(parsed.content).toBe(
        "The user asked about weather, so I should search.",
      );
    });
  });

  describe("when a user turn references an image by source", () => {
    /** @scenario "A multimodal user turn referencing an image by source is accepted" */
    it("accepts the snapshot and preserves the image source", () => {
      const parsed = parseOneMessage({
        id: "msg-5",
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              value: "https://example.test/cat.png",
              mimeType: "image/png",
            },
          },
        ],
      });

      expect(parsed.content).toEqual([
        {
          type: "image",
          source: {
            type: "url",
            value: "https://example.test/cat.png",
            mimeType: "image/png",
          },
        },
      ]);
    });
  });

  describe("when a message carries an encrypted payload", () => {
    /** @scenario "An encrypted message payload is preserved" */
    it("accepts the snapshot and preserves the encrypted value", () => {
      const parsed = parseOneMessage({
        id: "msg-6",
        role: "assistant",
        content: "redacted",
        encryptedValue: "enc:abc123",
      });

      expect(parsed.encryptedValue).toBe("enc:abc123");
    });
  });
});

describe("given an agent emitting messages in the OpenAI dialect", () => {
  describe("when an assistant turn requests tools with the snake_case spelling", () => {
    /** @scenario "An assistant turn in the OpenAI dialect keeps its tool calls" */
    it("accepts the snapshot and preserves the tool calls", () => {
      const parsed = parseOneMessage({
        role: "assistant",
        content: "checking",
        tool_calls: [
          {
            id: "call-9",
            type: "function",
            function: { name: "lookup", arguments: "{}" },
          },
        ],
      });

      expect(parsed.tool_calls).toEqual([
        {
          id: "call-9",
          type: "function",
          function: { name: "lookup", arguments: "{}" },
        },
      ]);
    });
  });

  describe("when a message carries no identifier", () => {
    /** @scenario "A message with no identifier is accepted" */
    it("accepts the snapshot", () => {
      const parsed = parseOneMessage({ role: "assistant", content: "hello" });

      expect(parsed.content).toBe("hello");
    });
  });
});

describe("given a scenario event envelope", () => {
  describe("when the type is a scenario event type", () => {
    /** @scenario "Scenario event types are accepted on the envelope" */
    it("accepts the snapshot", () => {
      const result = scenarioMessageSnapshotSchema.safeParse(
        makeSnapshot([{ role: "user", content: "hi" }]),
      );

      expect(result.success).toBe(true);
      expect(result.success && result.data.type).toBe(
        ScenarioEventType.MESSAGE_SNAPSHOT,
      );
    });
  });

  describe("when a message is not an object", () => {
    /** @scenario "A message snapshot rejects a message that is not an object" */
    it("rejects the snapshot", () => {
      const result = scenarioMessageSnapshotSchema.safeParse(
        makeSnapshot(["just a string"]),
      );

      expect(result.success).toBe(false);
    });
  });
});
