// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A redelivered span leaves its project's day as it was: the row keeps the delivery's applied
 * event ids, which the fold executor checks before it folds (foldProjectionExecutor.ts,
 * dropAlreadyApplied), and the fold never re-folds a row from one trace's log.
 * @see enterprise/modules/nurturing/specs/project-usage.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import {
  nurturingTraceDayPeerFold,
  type NurturingTraceSpanEvent,
} from "../nurturing-project-usage.pipeline.ts";

const NOON = Date.UTC(2026, 10, 20, 12);

function rootSpan(id: string, createdAt: number): NurturingTraceSpanEvent {
  return {
    id,
    aggregateId: `trace-${id}`,
    aggregateType: "trace",
    tenantId: createTenantId("project-1"),
    createdAt,
    occurredAt: createdAt,
    version: "2025-12-14",
    type: SPAN_RECEIVED_EVENT_TYPE,
    data: { span: { parentSpanId: null, status: { message: null, code: 1 } } },
  };
}

/** The executor's step for one delivery: skip an applied event, else fold, store, and mark it. */
function harness() {
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const { fold } = nurturingTraceDayPeerFold(traceDays);
  const deliver = async (event: NurturingTraceSpanEvent) => {
    const key = fold.key?.(event) ?? "";
    const context = { aggregateId: event.aggregateId, tenantId: event.tenantId, key };
    const loaded = await traceDays.store.getWithApplied?.(key, context);
    if (loaded?.appliedEventIds.includes(event.id)) return;
    const state = fold.apply(loaded?.state ?? fold.init(), event);
    await traceDays.store.store(state, { ...context, appliedEventIds: [event.id] });
  };
  const counted = async () =>
    (await traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "2026-11-19" }))[0]
      ?.traceCount;
  return { deliver, counted };
}

describe("the trace-day fold on redelivery", () => {
  /** @scenario "A redelivered span counts once" */
  it("counts a root span delivered twice once", async () => {
    const { deliver, counted } = harness();
    const span = rootSpan("span-1", NOON);

    await deliver(span);
    await deliver(span);

    expect(await counted()).toBe(1);
  });

  /** @scenario "Spans arriving out of order count the same" */
  it("counts an older trace's root span that arrives after a newer one", async () => {
    const { deliver, counted } = harness();

    await deliver(rootSpan("span-2", NOON + 1000));
    await deliver(rootSpan("span-1", NOON));

    expect(await counted()).toBe(2);
  });
});
