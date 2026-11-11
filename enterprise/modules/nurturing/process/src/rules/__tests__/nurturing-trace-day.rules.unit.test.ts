// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it } from "vitest";

import {
  addTrace,
  emptyTraceDay,
  type NurturingTraceDay,
  type NurturingTraceSpan,
  traceCountsOf,
  traceDayIncrementsOf,
} from "../nurturing-trace-day.rules.ts";

const AT = Date.UTC(2026, 10, 19, 12);

const span = (overrides: Partial<NurturingTraceSpan> = {}): NurturingTraceSpan => ({
  projectId: "project-1",
  day: "2026-11-19",
  isError: false,
  appendedAt: AT,
  ...overrides,
});

const addAll = (spans: readonly NurturingTraceSpan[]) => spans.reduce(addTrace, emptyTraceDay());

describe("addTrace()", () => {
  /** @scenario "A trace is its root span, counted on its project's day" */
  it("adds one trace per root span, keeping the newest time", () => {
    expect(addAll([span(), span({ appendedAt: AT + 1000 })])).toEqual({
      projectId: "project-1",
      day: "2026-11-19",
      traceCount: 2,
      errorCount: 0,
      lastTraceAt: AT + 1000,
      lastFailedTraceAt: null,
    });
  });

  /** @scenario "A failed trace is a root span with an error status" */
  it("counts an erroring root span as a failed trace too", () => {
    const day = addAll([
      span({ isError: true, appendedAt: AT + 2000 }),
      span({ appendedAt: AT + 4000 }),
    ]);

    expect(day).toMatchObject({
      traceCount: 2,
      errorCount: 1,
      lastTraceAt: AT + 4000,
      lastFailedTraceAt: AT + 2000,
    });
  });

  /** @scenario "Traces arriving out of order count the same" */
  it("answers the same counts whatever order the traces arrive in", () => {
    const spans = [span({ appendedAt: AT + 2000 }), span({ isError: true, appendedAt: AT })];

    expect(addAll(spans)).toEqual(addAll(spans.toReversed()));
  });
});

describe("traceDayIncrementsOf()", () => {
  /** @scenario "Root spans of one project and day are written as one increment" */
  it("sums a batch's root spans into one increment per project and day", () => {
    const increments = traceDayIncrementsOf([
      span(),
      span({ isError: true, appendedAt: AT + 1000 }),
      span({ day: "2026-11-20", appendedAt: AT + 86_400_000 }),
      span({ projectId: "project-2" }),
    ]);

    expect(increments).toEqual([
      {
        projectId: "project-1",
        day: "2026-11-19",
        traceCount: 2,
        errorCount: 1,
        lastTraceAt: AT + 1000,
        lastFailedTraceAt: AT + 1000,
      },
      expect.objectContaining({ projectId: "project-1", day: "2026-11-20", traceCount: 1 }),
      expect.objectContaining({ projectId: "project-2", day: "2026-11-19", traceCount: 1 }),
    ]);
  });
});

describe("traceCountsOf()", () => {
  const day = (overrides: Partial<NurturingTraceDay>): NurturingTraceDay => ({
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
