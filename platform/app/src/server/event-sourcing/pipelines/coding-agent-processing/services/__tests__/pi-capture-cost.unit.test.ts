/**
 * Does the money pi's capture builds actually reach the session?
 *
 * The builder next door (`sdks/typescript/.../pi-turn-events.ts`) has its own
 * unit suite, and it proves the payload carries the right numbers. That is not
 * the same claim as this one. Between the builder and the session total sit
 * three filters that can each silently drop a cost while every builder test
 * stays green:
 *
 *   1. `liftCodingAgentLogFacts` keeps only the attributes on a fixed
 *      allowlist — a `cost_usd` under any other spelling never becomes a fact.
 *   2. `detectCodingAgent` has to answer `pi`, or the record is not a coding
 *      agent's at all and is dropped before the fold.
 *   3. `normalizeEventName` has to land pi's namespaced name on
 *      `api_request` exactly, because that is the ONE case in
 *      `applyLogToCodingAgentSession` that adds to `costUsd`. A name that
 *      normalizes to `tool_result`, or to nothing, folds a cost of zero and
 *      reports no error while doing it.
 *
 * So this runs the real builder's output through the real three, and asserts
 * the session's own total. The builder is imported across the package boundary
 * by path — the app and the CLI are separate builds, and this is how the
 * repository already crosses that line (see
 * `features/langy/__tests__/LangyCapabilityCardSelection.integration.test.tsx`).
 * Restating pi's event names as literals here would prove only that this file
 * agrees with itself.
 *
 * @see specs/coding-agent/pi-session-capture.feature
 * @see dev/docs/adr/132-pi-as-tracked-coding-agent.md
 */
import { describe, expect, it } from "vitest";

import { parsePiSessionFile } from "../../../../../../../../../sdks/typescript/src/cli/utils/governance/pi-session-file";
import {
  buildPiTurnEvents,
  PI_EVENT_SCOPE,
  PI_SERVICE_NAME,
  type PiTurnEvent,
} from "../../../../../../../../../sdks/typescript/src/cli/utils/governance/pi-turn-events";
import {
  detectCodingAgent,
  liftCodingAgentLogFacts,
  normalizeEventName,
} from "../coding-agent-normalization";
import {
  applyLogToCodingAgentSession,
  type CodingAgentSessionData,
  createInitCodingAgentSession,
} from "../coding-agent-session.derivation";

const SESSION_ID = "00000000-0000-4000-8000-0000000000c0";

function sessionFile(entries: readonly unknown[]): string {
  return [
    {
      type: "session",
      version: 3,
      id: SESSION_ID,
      timestamp: "2026-09-14T09:00:00.000Z",
      cwd: "/tmp/project",
    },
    ...entries,
  ]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
}

/**
 * The three billed shapes of pi's format, at the three costs the scenario
 * names: an assistant turn at 10, a tool that did nested LLM work at 3
 * (`session-format.md:99`), and the summary written for a compaction at 2
 * (`:244`). Every `usage` sits where pi puts it for that row kind.
 */
const BILLED_SESSION = parsePiSessionFile(
  sessionFile([
    {
      type: "message",
      id: "aaaaaaaa",
      parentId: null,
      timestamp: "2026-09-14T09:00:01.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "xxxx" }],
        timestamp: Date.parse("2026-09-14T09:00:01.000Z"),
      },
    },
    {
      type: "message",
      id: "bbbbbbbb",
      parentId: "aaaaaaaa",
      timestamp: "2026-09-14T09:00:02.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "xxxx" }],
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        stopReason: "toolUse",
        timestamp: Date.parse("2026-09-14T09:00:02.000Z"),
        usage: {
          input: 100,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 120,
          cost: { total: 10 },
        },
      },
    },
    {
      type: "message",
      id: "cccccccc",
      parentId: "bbbbbbbb",
      timestamp: "2026-09-14T09:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "task",
        content: [{ type: "text", text: "xxxx" }],
        isError: false,
        timestamp: Date.parse("2026-09-14T09:00:03.000Z"),
        // "Nested LLM work performed by the tool" — pi's own comment on this
        // field. It is billed, and pi's session totals count it.
        usage: {
          input: 40,
          output: 5,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 45,
          cost: { total: 3 },
        },
      },
    },
    {
      type: "compaction",
      id: "dddddddd",
      parentId: "cccccccc",
      timestamp: "2026-09-14T09:00:04.000Z",
      summary: "xxxx",
      tokensBefore: 50000,
      // On the ENTRY, not on a message: a compaction has no message at all.
      usage: {
        input: 30,
        output: 8,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 38,
        cost: { total: 2 },
      },
    },
  ]),
);

/**
 * Everything the ingestion path does to one pi event between the wire and the
 * session, in the order it does it. Returns the state unchanged for a record
 * the path drops, exactly as the pipeline would.
 */
function ingest({
  state,
  event,
}: {
  state: CodingAgentSessionData;
  event: PiTurnEvent;
}): CodingAgentSessionData {
  const facts = liftCodingAgentLogFacts({
    scopeName: PI_EVENT_SCOPE,
    attributes: event.attributes,
  });
  if (facts === null) return state;
  const agent = detectCodingAgent({
    scopeName: PI_EVENT_SCOPE,
    recordName: event.name,
    serviceName: PI_SERVICE_NAME,
  });
  if (agent === "unknown") return state;
  return applyLogToCodingAgentSession({
    state,
    attributes: facts,
    agent,
    occurredAtMs: event.timeUnixMs,
  });
}

function foldAll(events: readonly PiTurnEvent[]): CodingAgentSessionData {
  return events.reduce(
    (state, event) => ingest({ state, event }),
    createInitCodingAgentSession(),
  );
}

describe("pi's captured cost reaching the session", () => {
  describe("given a session billing an assistant turn, a tool and a compaction", () => {
    /** @scenario "The session cost counts assistant turns, work inside tools, and summarised stretches" */
    it("adds all three to the session's cost", () => {
      const events = buildPiTurnEvents(BILLED_SESSION);

      const session = foldAll(events);

      expect(session.costUsd).toBe(15);
      expect(session.agentReportedCostUsd).toBe(15);
    });

    /** @scenario "The session cost counts assistant turns, work inside tools, and summarised stretches" */
    it("carries each cost on the one event the fold reads a cost from", () => {
      const events = buildPiTurnEvents(BILLED_SESSION);

      const billed = events.filter(
        (event) => event.attributes.cost_usd !== undefined,
      );

      // Self-check first: an empty list would satisfy the claim below while
      // proving nothing at all.
      expect(billed.map((event) => event.attributes.cost_usd)).toEqual([
        10, 3, 2,
      ]);
      for (const event of billed) {
        expect(normalizeEventName(event.name)).toBe("api_request");
      }
    });

    it("counts the nested and the summarising call as model calls, and every row's tokens", () => {
      const session = foldAll(buildPiTurnEvents(BILLED_SESSION));

      expect(session.modelCalls).toBe(3);
      expect(session.inputTokens).toBe(170);
      expect(session.outputTokens).toBe(33);
    });
  });

  describe("given every event a pi capture emits", () => {
    it("survives the attribute allowlist and the agent detector", () => {
      const events = buildPiTurnEvents(BILLED_SESSION);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(
          liftCodingAgentLogFacts({
            scopeName: PI_EVENT_SCOPE,
            attributes: event.attributes,
          }),
        ).not.toBeNull();
        expect(
          detectCodingAgent({
            scopeName: PI_EVENT_SCOPE,
            recordName: event.name,
            serviceName: PI_SERVICE_NAME,
          }),
        ).toBe("pi");
      }
    });

    /**
     * Deliberately NOT bound to "Measurements pi never reports are left blank
     * rather than shown as zero". That scenario is about what a reader SEES,
     * and what the fold holds for these four is a literal 0
     * (`coding-agent-session.derivation.ts:375-378`); the blankness is
     * `SessionView.tsx:522,547` suppressing a zero stat, which is
     * agent-agnostic and predates pi. What is pi's own and is worth pinning is
     * this: a capture that folds real cost, tokens and model calls moves none
     * of the produced-work measurements off their starting value, because pi
     * reports none of them and the capture invents none.
     */
    it("moves no produced-work measurement, having moved the cost", () => {
      const session = foldAll(buildPiTurnEvents(BILLED_SESSION));
      const initial = createInitCodingAgentSession();

      expect(session.costUsd).toBeGreaterThan(0);
      expect(session.linesAdded).toBe(initial.linesAdded);
      expect(session.linesRemoved).toBe(initial.linesRemoved);
      expect(session.commits).toBe(initial.commits);
      expect(session.pullRequests).toBe(initial.pullRequests);
    });
  });
});
