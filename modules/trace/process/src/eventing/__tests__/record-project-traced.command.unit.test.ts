/** Spec: modules/trace/specs/project-traced-fact.feature */
import { createTenantId } from "@langwatch/eventing";
import { PROJECT_TRACED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { RecordProjectTracedCommand } from "../trace-project-milestones.commands.ts";
import { TRACE_PROJECT_AGGREGATE_TYPE } from "../trace-project-milestones.events.ts";

describe("RecordProjectTracedCommand", () => {
  const record = (organizationId: string | null) =>
    new RecordProjectTracedCommand().handle({
      tenantId: createTenantId("project-1"),
      aggregateId: "project-1",
      type: "lw.trace.record_project_traced",
      data: { tenantId: "project-1", projectId: "project-1", organizationId, occurredAt: 1_000 },
    });

  /** @scenario "A redelivered first trace records the project as traced once" */
  it("appends one traced event on the project, keyed by the project alone", () => {
    const [first] = record("org-1");
    const [again] = record("org-1");

    expect(first).toMatchObject({
      type: PROJECT_TRACED_EVENT_TYPE,
      aggregateType: TRACE_PROJECT_AGGREGATE_TYPE,
      aggregateId: "project-1",
      occurredAt: 1_000,
      data: { projectId: "project-1", organizationId: "org-1" },
      idempotencyKey: "project-1:project_traced",
    });
    expect(again?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  /** @scenario "A project with no organization is recorded as traced with none" */
  it("records a project with no organization as traced with none", () => {
    const [event] = record(null);

    expect(event?.data.organizationId).toBeNull();
  });
});
