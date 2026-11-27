// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What the trace read remembers: a settled week for half an hour, a pending one for as long as it
 * is in flight, however full the store.
 * @see enterprise/modules/digest/specs/digest.feature
 */
import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DigestTraceReadService,
  MAX_REMEMBERED,
  REMEMBER_MS,
} from "../digest-trace-read.service.ts";

const ORGANIZATION = "org";
const ISO_WEEK = "2026-W30";
const PENDING_PROJECT = "pending-project";

type Answer = Awaited<ReturnType<AnalyticsApi["getTimeseries"]>>;
const ANSWER: Answer = { previousPeriod: [], currentPeriod: [{ date: "full" }] };

function build() {
  const reads: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const analytics = createApiFixture<Pick<AnalyticsApi, "getTimeseries">>(
    {
      getTimeseries: async ({ projectId }) => {
        reads.push(projectId);
        if (projectId === PENDING_PROJECT) await held;
        return ANSWER;
      },
    },
    "AnalyticsApi",
  );
  const service = DigestTraceReadService.create({ analytics, now: () => Date.now() });
  const previous = (projectId: string) =>
    service.getPreviousTraces({ organizationId: ORGANIZATION, projectId, isoWeek: ISO_WEEK });
  return { reads, release, previous };
}

describe("the trace read's memory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "Trace numbers are read from analytics, never folded" */
  it("reads a week again once a settled answer is older than the memory", async () => {
    const { reads, previous } = build();

    await previous("p1");
    await previous("p1");
    expect(reads).toEqual(["p1"]);

    vi.advanceTimersByTime(REMEMBER_MS + 1);
    await previous("p1");
    expect(reads).toEqual(["p1", "p1"]);
  });

  /** @scenario "Trace numbers are read from analytics, never folded" */
  it("keeps a read still in flight when the store fills, so it stays shared", async () => {
    const { reads, release, previous } = build();

    const first = previous(PENDING_PROJECT);
    await Promise.all(Array.from({ length: MAX_REMEMBERED - 1 }, (_, i) => previous(`p${i}`)));
    await previous("one-too-many");
    const second = previous(PENDING_PROJECT);

    release();
    await Promise.all([first, second]);
    expect(reads.filter((id) => id === PENDING_PROJECT)).toHaveLength(1);
  });
});
