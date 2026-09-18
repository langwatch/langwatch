import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildPiEventsPayload,
  buildPiTurnEvents,
  PI_EVENT,
  PI_EVENT_SCOPE,
  PI_SERVICE_NAME,
  type PiTurnEvent,
} from "../pi-turn-events";
import { parsePiSessionFile, type PiSession } from "../pi-session-file";

/**
 * A real 132-row pi session, sanitised: every prompt, reply and tool output
 * replaced with `x`, ids renumbered, the rest of each row left exactly as pi
 * wrote it. Two providers, three model changes, 69 tool results, 5 turns billed
 * at zero.
 */
const REAL_SESSION = parsePiSessionFile(
  readFileSync(
    join(__dirname, "fixtures", "pi-session-real-shape.jsonl"),
    "utf8",
  ),
);

const SESSION_ID = "00000000-0000-4000-8000-000000000001";

/** A session built row by row, for shapes the real file does not contain. */
function sessionOf(lines: readonly unknown[]): PiSession {
  return parsePiSessionFile(
    [
      {
        type: "session",
        version: 3,
        id: SESSION_ID,
        timestamp: "2026-09-13T15:38:12.783Z",
        cwd: "/tmp/project",
      },
      ...lines,
    ]
      .map((line) => JSON.stringify(line))
      .join("\n"),
  );
}

function userRow({ id, at, text }: { id: string; at: string; text: string }) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: at,
    message: {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.parse(at),
    },
  };
}

function assistantRow({
  id,
  at,
  usage,
  text = "xxxx",
}: {
  id: string;
  at: string;
  usage?: unknown;
  text?: string;
}) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: at,
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "claude-opus-4-6",
      stopReason: "stop",
      timestamp: Date.parse(at),
      ...(usage === undefined ? {} : { usage }),
    },
  };
}

function toolResultRow({
  id,
  at,
  text = "xxxxx",
}: {
  id: string;
  at: string;
  text?: string;
}) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: at,
    message: {
      role: "toolResult",
      toolCallId: "aaaabbbb",
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: Date.parse(at),
    },
  };
}

function attributesOf(event: PiTurnEvent | undefined) {
  return event?.attributes ?? {};
}

describe("building pi's turn events", () => {
  describe("given a session of user prompts, a tool call and assistant replies", () => {
    /** @scenario "A captured pi session records every turn in the order pi wrote them" */
    it("emits one event per row, in the order pi wrote them", () => {
      const events = buildPiTurnEvents({
        session: sessionOf([
          userRow({ id: "aaaa0001", at: "2026-09-13T15:39:23.074Z", text: "one" }),
          assistantRow({ id: "aaaa0002", at: "2026-09-13T15:39:25.000Z" }),
          toolResultRow({ id: "aaaa0003", at: "2026-09-13T15:39:26.000Z" }),
          userRow({ id: "aaaa0004", at: "2026-09-13T15:39:30.000Z", text: "two" }),
          assistantRow({ id: "aaaa0005", at: "2026-09-13T15:39:33.000Z" }),
        ]),
      });

      expect(events.map((event) => event.name)).toEqual([
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
        PI_EVENT.TOOL_RESULT,
        PI_EVENT.USER_PROMPT,
        PI_EVENT.API_REQUEST,
      ]);
    });

    /**
     * The other half of the scenario, and the half nothing asserted while the
     * scenario claimed the conversation was captured: the events carry the
     * shape of the turn and none of its text.
     *
     * All three texts are planted HERE and asserted from the same constants,
     * so the assertion cannot drift away from the fixture. The first version of
     * this test hard-coded the assistant and tool bodies as the literal "xxxx"
     * copied out of the helpers, and its comment claimed that made a future
     * leak fail without anyone remembering to extend a list. That was false and
     * was caught by running it: renaming the assistant helper's text and then
     * leaking it left all eleven tests green, because the assertion was still
     * searching for a string the payload no longer had any reason to contain.
     * A guard whose needle is not the fixture's own value asserts nothing once
     * the fixture moves.
     *
     * Lengths and names are asserted alongside, because "no text" must not be
     * satisfiable by dropping the turn.
     */
    /** @scenario "A captured pi session records every turn in the order pi wrote them" */
    it("records each turn's speaker, timing and usage, and none of its text", () => {
      const promptText = "SECRETPROMPT";
      const replyText = "PRIVATEREPLY";
      const toolText = "TOOLOUTPUTBODY";

      const events = buildPiTurnEvents({
        session: sessionOf([
          userRow({
            id: "aaaa0001",
            at: "2026-09-13T15:39:23.074Z",
            text: promptText,
          }),
          assistantRow({
            id: "aaaa0002",
            at: "2026-09-13T15:39:25.000Z",
            text: replyText,
          }),
          toolResultRow({
            id: "aaaa0003",
            at: "2026-09-13T15:39:26.000Z",
            text: toolText,
          }),
        ]),
      });

      const serialised = JSON.stringify(
        buildPiEventsPayload({ events, scopeVersion: "1.2.3" }),
      );

      for (const text of [promptText, replyText, toolText]) {
        expect(serialised).not.toContain(text);
      }

      // Recorded, not merely absent: each turn is there, and measured.
      expect(attributesOf(events[0]).prompt_length).toBe(promptText.length);
      expect(attributesOf(events[1]).model).toBe("claude-opus-4-6");
      expect(attributesOf(events[2]).tool_result_size_bytes).toBe(
        toolText.length,
      );
      expect(attributesOf(events[2]).tool_name).toBe("read");
    });
  });

  describe("given the whole of a real session", () => {
    /** @scenario "A captured pi session records every turn in the order pi wrote them" */
    it("keeps every conversation row, interleaved exactly as the file has them", () => {
      const events = buildPiTurnEvents({ session: REAL_SESSION });

      // Derived from the file itself rather than pasted, so the assertion is
      // "the events follow the rows" and not "the events follow a list someone
      // typed once". A build that grouped by kind, sorted on the message clock,
      // or dropped a row kind fails it.
      const expected = REAL_SESSION.rows
        .filter((row) => row.type === "message")
        .map((row) =>
          row.message?.role === "user"
            ? PI_EVENT.USER_PROMPT
            : row.message?.role === "assistant"
              ? PI_EVENT.API_REQUEST
              : PI_EVENT.TOOL_RESULT,
        );

      expect(expected).toHaveLength(127);
      expect(events.map((event) => event.name)).toEqual(expected);
    });

    it("stamps a turn with the entry clock, not the message clock", () => {
      // Measured on this row: pi wrote the message timestamp when the turn
      // began and appended the entry 6,017 ms later, when the reply landed. The
      // two clocks are different types AND different instants, so a build that
      // reached for the wrong one is off by seconds, not by rounding.
      const row = REAL_SESSION.rows.find((r) => r.id === "10011110");
      expect(Date.parse(row?.timestamp ?? "")).toBe(1789314244089);
      expect(row?.message?.timestampMs).toBe(1789314238072);

      const events = buildPiTurnEvents({ session: REAL_SESSION });
      const index = REAL_SESSION.rows
        .filter((r) => r.type === "message")
        .findIndex((r) => r.id === "10011110");

      expect(events[index]?.timeUnixMs).toBe(1789314244089);
    });
  });

  describe("given an assistant turn pi billed at zero", () => {
    /** @scenario "A turn pi charged nothing for is recorded as zero" */
    it("records the zero", () => {
      const events = buildPiTurnEvents({
        session: sessionOf([
          assistantRow({
            id: "aaaa0001",
            at: "2026-09-13T15:39:25.000Z",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          }),
        ]),
      });

      expect(attributesOf(events[0])).toMatchObject({ cost_usd: 0 });
    });

    /** @scenario "A turn pi charged nothing for is recorded as zero" */
    it("records the zero on the five such turns of a real session", () => {
      const events = buildPiTurnEvents({ session: REAL_SESSION });
      const zeroes = events.filter(
        (event) => event.attributes.cost_usd === 0,
      );

      // Five errored turns in the measured session were billed at exactly zero.
      // Their cost is reported, and reported as nothing.
      expect(zeroes).toHaveLength(5);
      expect(attributesOf(zeroes[0])).toMatchObject({
        cost_usd: 0,
        stop_reason: "error",
      });
    });
  });

  describe("given an assistant turn pi reported no cost for", () => {
    /** @scenario "A turn carrying no cost at all is left blank rather than counted as zero" */
    it("leaves the cost off the record entirely", () => {
      // Not a shape the measured session contains — all 43 of its assistant
      // rows report a cost — so the row is built here from the real one with
      // `usage` removed, which is what a turn that died before billing leaves.
      const events = buildPiTurnEvents({
        session: sessionOf([assistantRow({ id: "aaaa0001", at: "2026-09-13T15:39:25.000Z" })]),
      });

      expect(events).toHaveLength(1);
      expect(attributesOf(events[0])).not.toHaveProperty("cost_usd");
      // And the turn is still a record — the missing number is the only thing
      // missing, not the turn.
      expect(attributesOf(events[0])).toMatchObject({
        "event.name": PI_EVENT.API_REQUEST,
        model: "claude-opus-4-6",
      });
    });
  });

  describe("given a session an anthropic model answered", () => {
    /** @scenario "The record names pi even though another provider answered" */
    it("names pi in the identity fields and anthropic only as the provider", () => {
      const payload = buildPiEventsPayload({
        events: buildPiTurnEvents({ session: REAL_SESSION }),
        scopeVersion: "0.0.0-test",
      });

      const resource = payload.resourceLogs[0]?.resource;
      const scopeLogs = payload.resourceLogs[0]?.scopeLogs[0];
      expect(resource?.attributes).toEqual([
        { key: "service.name", value: { stringValue: PI_SERVICE_NAME } },
      ]);
      expect(PI_SERVICE_NAME).toBe("pi");
      expect(scopeLogs?.scope.name).toBe(PI_EVENT_SCOPE);

      // The scenario's own words: no scope or service name contains anthropic.
      expect(scopeLogs?.scope.name).not.toContain("anthropic");
      expect(JSON.stringify(resource)).not.toContain("anthropic");

      const records = scopeLogs?.logRecords ?? [];
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.eventName.startsWith("pi.")).toBe(true);
      }

      // ...and the provider is still recorded, as a property of a pi turn. Were
      // it merely absent, the assertions above would pass on a capture that
      // threw the fact away rather than one that placed it correctly.
      const providers = records.flatMap((record) =>
        record.attributes
          .filter((attribute) => attribute.key === "gen_ai.provider.name")
          .map((attribute) => attribute.value.stringValue),
      );
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai-codex");
    });
  });

  describe("given a batch of pi events", () => {
    it("builds a logs body and no spans", () => {
      const payload = buildPiEventsPayload({
        events: buildPiTurnEvents({ session: REAL_SESSION }),
        scopeVersion: "0.0.0-test",
      });

      expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords).toHaveLength(
        127,
      );
      expect(payload).not.toHaveProperty("resourceSpans");
      expect(JSON.stringify(payload)).not.toContain("resourceSpans");
    });

    it("spells a cost as a double and a token count as an integer", () => {
      const payload = buildPiEventsPayload({
        events: buildPiTurnEvents({ session: REAL_SESSION }),
        scopeVersion: "0.0.0-test",
      });
      const records = payload.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? [];
      const priced = records.find((record) =>
        record.attributes.some(
          (attribute) =>
            attribute.key === "cost_usd" &&
            attribute.value.doubleValue !== undefined &&
            attribute.value.doubleValue > 0,
        ),
      );

      const cost = priced?.attributes.find((a) => a.key === "cost_usd");
      const input = priced?.attributes.find((a) => a.key === "input_tokens");
      // A zero cost stays a double too, so the field does not change type
      // between a cheap turn and a free one.
      const free = records
        .flatMap((record) => record.attributes)
        .find((a) => a.key === "cost_usd" && a.value.doubleValue === 0);

      expect(cost?.value).toEqual({ doubleValue: 0.05636000000000001 });
      expect(input?.value).toEqual({ intValue: "5441" });
      expect(free?.value).toEqual({ doubleValue: 0 });
    });
  });

  describe("given a session whose file carries no header id", () => {
    it("emits nothing rather than events belonging to no session", () => {
      const headerless = parsePiSessionFile(
        JSON.stringify(
          userRow({
            id: "aaaa0001",
            at: "2026-09-13T15:39:23.074Z",
            text: "one",
          }),
        ),
      );

      expect(headerless.rows).toHaveLength(1);
      expect(buildPiTurnEvents({ session: headerless })).toEqual([]);
    });
  });
});
