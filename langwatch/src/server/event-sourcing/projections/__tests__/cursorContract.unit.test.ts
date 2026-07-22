import { describe, expect, it } from "vitest";
import {
  compareLangyEventCursors,
  cursorHasReachedEvent,
} from "@langwatch/langy";

import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { compareCursors, cursorFor } from "../stateProjectionExecutor";

/**
 * ADR-059's time-base contract, pinned.
 *
 * A cursor persisted next to a Postgres projection (`cursorFor`) must be valid
 * against a tail read from ClickHouse — which orders `(EventTimestamp,
 * EventId)`, and `recordToEvent` maps `EventTimestamp` onto `event.createdAt`.
 * So the WHOLE chain hangs on: cursor.acceptedAt IS event.createdAt, and the
 * framework's comparator agrees with the shared package comparator the browser
 * folds with (`@langwatch/langy`). If either half drifts, client catch-up
 * silently skips or re-folds events — this file is what fails instead.
 */

function event(overrides: Partial<Event>): Event {
  return {
    id: "2AAAAAAAAAAAAAAAAAAAAAAAAAA",
    aggregateId: "conv-1",
    aggregateType: "langy_conversation" as Event["aggregateType"],
    tenantId: createTenantId("proj-1"),
    createdAt: 1_000,
    occurredAt: 900,
    type: "lw.langy_conversation.agent_turn_accepted",
    version: "2026-07-10",
    data: {},
    ...overrides,
  };
}

describe("the projection cursor's time base", () => {
  it("stamps acceptedAt from the LOG-ACCEPT time (createdAt), never occurredAt", () => {
    // occurredAt deliberately differs so a regression to business time fails.
    const cursor = cursorFor(event({ createdAt: 1_000, occurredAt: 900 }));
    expect(cursor).toEqual({
      acceptedAt: 1_000,
      eventId: "2AAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
  });
});

describe("the framework comparator and the shared package comparator", () => {
  const cases: Array<[string, Event, Event]> = [
    ["time-ordered", event({ createdAt: 1 }), event({ createdAt: 2 })],
    [
      "same-millisecond id tie-break",
      event({ id: "2AAAa" }),
      event({ id: "2AAAb" }),
    ],
    [
      // Byte order puts uppercase ASCII first; locale collation typically does
      // not. KSUIDs are mixed-case base62, so this case decides real orderings.
      "byte-wise (case) tie-break",
      event({ id: "2AAAB" }),
      event({ id: "2AAAa" }),
    ],
    ["identical", event({}), event({})],
  ];

  it.each(cases)("agree on %s", (_name, left, right) => {
    const frameworkOrder = compareCursors(cursorFor(left), cursorFor(right));
    const sharedOrder = compareLangyEventCursors(
      { acceptedAt: left.createdAt, eventId: left.id },
      { acceptedAt: right.createdAt, eventId: right.id },
    );
    expect(Math.sign(frameworkOrder)).toBe(Math.sign(sharedOrder));
  });

  it("cursorHasReachedEvent reads the same time base (inclusive)", () => {
    const e = event({});
    expect(cursorHasReachedEvent(cursorFor(e), e)).toBe(true);
    expect(
      cursorHasReachedEvent(cursorFor(e), {
        id: e.id,
        createdAt: e.createdAt + 1,
      }),
    ).toBe(false);
  });
});
