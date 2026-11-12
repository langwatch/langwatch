// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  TRACE_COUNTING_WINDOW_MS,
  UNCOPIED_PROJECT_DROP_CACHE_TTL_MS,
  UNCOPIED_PROJECT_RETRY_WINDOW_MS,
} from "../../rules/nurturing-project-usage.rules.ts";
import type { NurturingCountedTrace } from "../../rules/nurturing-trace-day.rules.ts";
import { countingOver } from "./nurturing-trace-counting.test-helpers.ts";

const NOON = Date.UTC(2026, 10, 20, 12);
const DAY_BEFORE_NOON = NOON - 86_400_000;

/** One counted trace of `projectId`, appended at `at`. */
const traceOf = (at = NOON, projectId = "project-1"): NurturingCountedTrace => ({
  projectId,
  kind: "trace",
  day: new Date(at).toISOString().slice(0, 10),
  at,
});

describe("NurturingTraceCountingService", () => {
  /** project-1's organization, created the day before NOON unless told otherwise. */
  function harness(createdAt = DAY_BEFORE_NOON) {
    const counting = countingOver({ createdAt });
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    return { counting, days };
  }

  /** @scenario "An organization past its counting window writes no counts" */
  it("counts no trace of an organization past its window", async () => {
    const past = harness(NOON - TRACE_COUNTING_WINDOW_MS);
    const inside = harness(NOON - TRACE_COUNTING_WINDOW_MS + 1);

    await past.counting.countTraces({ traces: [traceOf()] });
    await inside.counting.countTraces({ traces: [traceOf()] });

    expect(await past.days()).toEqual([]);
    expect((await inside.days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "An organization past its counting window writes no counts" */
  it("counts no failure of an organization past its window", async () => {
    const { counting, days } = harness(NOON - TRACE_COUNTING_WINDOW_MS);

    await counting.countTraces({ traces: [{ ...traceOf(), kind: "failed" }] });

    expect(await days()).toEqual([]);
  });

  /** @scenario "A new project whose copy lands within the retry window is counted" */
  it("retries a new project's trace until its copy lands about 30 seconds later, then counts it once", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON, copied: false });
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });

    await expect(counting.countTraces({ traces: [traceOf()] })).rejects.toThrow(
      "has not landed yet",
    );
    expect(await days()).toEqual([]);

    counting.advance(30_000);
    await counting.landCopies();
    await counting.countTraces({ traces: [traceOf()] });
    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A new project whose copy lands within the retry window is counted" */
  it("counts nothing from a batch that waits for a project's copy, then each trace once on the retry", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON });
    const projectIds = ["project-1", "project-2"];
    const days = () => counting.traceDays.findForProjects({ projectIds, afterDay: "" });
    const traces = [traceOf(NOON, "project-1"), traceOf(NOON, "project-2")];

    await expect(counting.countTraces({ traces })).rejects.toThrow("has not landed yet");
    expect(await days()).toEqual([]);

    counting.advance(30_000);
    await counting.placements.recordProject({ projectId: "project-2", organizationId: "org-1" });
    await counting.uncopiedProjects.copyLanded({ projectId: "project-2" });
    await counting.countTraces({ traces });
    const sorted = (await days()).toSorted((a, b) => a.projectId.localeCompare(b.projectId));
    expect(sorted.map((day) => [day.projectId, day.traceCount])).toEqual([
      ["project-1", 1],
      ["project-2", 1],
    ]);
  });

  /** @scenario "A new project whose copy lands within the retry window is counted" */
  it("counts a trace whose copy lands a second before the window ends, on the next retry", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON, copied: false });
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });

    await expect(counting.countTraces({ traces: [traceOf()] })).rejects.toThrow(
      "has not landed yet",
    );
    counting.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS - 1000);
    await expect(counting.countTraces({ traces: [traceOf()] })).rejects.toThrow(
      "has not landed yet",
    );
    await counting.landCopies();
    counting.advance(1000);
    await counting.countTraces({ traces: [traceOf()] });

    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
  it("drops an uncopied project's trace once its window has passed, and its later traces with no read", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON, copied: false });
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    const placementReads = vi.spyOn(counting.placements, "getPlacement");

    await expect(counting.countTraces({ traces: [traceOf()] })).rejects.toThrow(
      "has not landed yet",
    );
    counting.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);
    await counting.countTraces({ traces: [traceOf()] });
    placementReads.mockClear();
    await counting.countTraces({ traces: [traceOf(NOON + 1000)] });
    expect(placementReads).not.toHaveBeenCalled();
    expect(await days()).toEqual([]);

    await counting.landCopies();
    await counting.countTraces({ traces: [traceOf(NOON + 2000)] });
    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A project with no copy after the retries is dropped, and its later batches at once" */
  it("reads a dropped project's copy again once its cached drop is older than the TTL, and counts it", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON, copied: false });
    const days = () =>
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" });
    await expect(counting.countTraces({ traces: [traceOf()] })).rejects.toThrow(
      "has not landed yet",
    );
    counting.advance(UNCOPIED_PROJECT_RETRY_WINDOW_MS);
    await counting.countTraces({ traces: [traceOf()] });
    await counting.landCopies({ onThisWorker: false });
    const placementReads = vi.spyOn(counting.placements, "getPlacement");

    counting.advance(UNCOPIED_PROJECT_DROP_CACHE_TTL_MS - 1);
    await counting.countTraces({ traces: [traceOf(NOON + 1000)] });
    expect(placementReads).not.toHaveBeenCalled();
    expect(await days()).toEqual([]);

    counting.advance(1);
    await counting.countTraces({ traces: [traceOf(NOON + 2000)] });
    expect(placementReads).toHaveBeenCalledTimes(1);
    expect((await days()).map((day) => day.traceCount)).toEqual([1]);
  });

  /** @scenario "A trace of an organization older than nurturing's creation copy is dropped" */
  it("drops without a retry a young trace of a placed project whose organization has no creation copy", async () => {
    const counting = countingOver({ createdAt: DAY_BEFORE_NOON, organizationCopied: false });

    await counting.countTraces({ traces: [traceOf()] });

    await expect(
      counting.traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
    ).resolves.toEqual([]);
  });
});
