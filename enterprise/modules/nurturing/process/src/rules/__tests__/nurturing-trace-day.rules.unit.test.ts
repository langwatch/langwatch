// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  emptyTraceDay,
  foldTraceDay,
  type NurturingTraceDayState,
  type NurturingTraceSpan,
  traceCountsOf,
} from "../nurturing-trace-day.rules.ts";

const AT = Date.UTC(2026, 10, 19, 12);

const span = (overrides: Partial<NurturingTraceSpan> = {}): NurturingTraceSpan => ({
  projectId: "project-1",
  day: "2026-11-19",
  isRoot: true,
  isError: false,
  appendedAt: AT,
  occurredAt: AT,
  ...overrides,
});

const foldAll = (spans: readonly NurturingTraceSpan[]) =>
  spans.reduce(foldTraceDay, emptyTraceDay());

describe("foldTraceDay()", () => {
  /** @scenario "A trace is its root span, counted on its project's day" */
  it("counts root spans as traces and leaves child spans out", () => {
    const state = foldAll([
      span(),
      span({ isRoot: false, appendedAt: AT + 3000 }),
      span({ appendedAt: AT + 1000 }),
    ]);

    expect(state).toEqual({
      projectId: "project-1",
      day: "2026-11-19",
      traceCount: 2,
      errorCount: 0,
      lastTraceAt: AT + 1000,
      lastFailedTraceAt: null,
      LastEventOccurredAt: AT,
    });
  });

  /** @scenario "A failed trace is a root span with an error status" */
  it("counts an erroring root span as a failed trace, and an erroring child as nothing", () => {
    const state = foldAll([
      span({ isError: true, appendedAt: AT + 2000 }),
      span({ isRoot: false, isError: true, appendedAt: AT + 5000 }),
      span({ appendedAt: AT + 4000 }),
    ]);

    expect(state).toMatchObject({
      traceCount: 2,
      errorCount: 1,
      lastTraceAt: AT + 4000,
      lastFailedTraceAt: AT + 2000,
    });
  });

  /** @scenario "Spans arriving out of order count the same" */
  it("answers the same counts whatever order the spans arrive in", () => {
    const spans = [
      span({ appendedAt: AT + 2000, occurredAt: AT + 2000 }),
      span({ isError: true, appendedAt: AT, occurredAt: AT }),
    ];

    expect(foldAll(spans)).toEqual(foldAll(spans.toReversed()));
  });
});

describe("traceCountsOf()", () => {
  const day = (overrides: Partial<NurturingTraceDayState>): NurturingTraceDayState => ({
    ...emptyTraceDay(),
    projectId: "project-1",
    traceCount: 1,
    lastTraceAt: AT,
    ...overrides,
  });

  /** @scenario "The organization's traits sum its projects' trace days" */
  it("sums the days after the window's start over every project", () => {
    const counts = traceCountsOf({
      windowStartDay: "2026-10-20",
      days: [
        day({ day: "2026-10-20", traceCount: 9 }),
        day({ day: "2026-11-18", traceCount: 2, errorCount: 1, lastFailedTraceAt: AT - 1 }),
        day({ projectId: "project-2", day: "2026-11-19", lastTraceAt: AT + 1 }),
        day({ day: "2026-11-19", traceCount: 0, lastTraceAt: null }),
      ],
    });

    expect(counts).toEqual({
      traceCount: 3,
      errorCount: 1,
      lastTraceAt: AT + 1,
      lastFailedTraceAt: AT - 1,
      activeDays: ["2026-11-18", "2026-11-19"],
    });
  });

  it("answers no traces for no days", () => {
    expect(traceCountsOf({ days: [], windowStartDay: "2026-10-20" })).toEqual({
      traceCount: 0,
      errorCount: 0,
      lastTraceAt: null,
      lastFailedTraceAt: null,
      activeDays: [],
    });
  });
});
