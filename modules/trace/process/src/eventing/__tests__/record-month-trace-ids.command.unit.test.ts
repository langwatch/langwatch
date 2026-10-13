/** Spec: modules/trace/specs/trace-month-trace-ids.feature */
import { createTenantId } from "@langwatch/eventing";
import { MONTH_TRACE_IDS_LISTED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { RecordMonthTraceIdsCommand } from "../trace-project-milestones.commands.ts";
import { TRACE_PROJECT_AGGREGATE_TYPE } from "../trace-project-milestones.events.ts";

describe("RecordMonthTraceIdsCommand", () => {
  /** @scenario "The trace ids event is recorded in trace's own event log" */
  it("appends one month trace ids event on the project, keyed by the page", () => {
    const data = {
      tenantId: "project-1",
      projectId: "project-1",
      month: "2026-10",
      traceIds: ["t1", "t2"],
    };

    const events = new RecordMonthTraceIdsCommand().handle({
      tenantId: createTenantId("project-1"),
      aggregateId: "project-1",
      type: "lw.trace.record_month_trace_ids",
      data,
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: MONTH_TRACE_IDS_LISTED_EVENT_TYPE,
      aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
      aggregateId: "project-1",
      data,
      idempotencyKey: "project-1:2026-10:t1:t2:2",
    });
  });
});
