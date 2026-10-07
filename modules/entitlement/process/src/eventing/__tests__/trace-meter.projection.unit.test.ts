import { createTenantId, type Event } from "@langwatch/eventing";
import type { ProjectApi } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import { TraceMeterAppendService } from "../../services/trace-meter-append.service.ts";
import { TraceMeterProjection } from "../trace-meter.projection.ts";

const ORGANIZATION = "org_1";
const OTHER_ORGANIZATION = "org_2";
const PROJECT = "project_a";
const OTHER_PROJECT = "project_b";
const ORPHAN_PROJECT = "project_orphan";

/** Answers from a fixed directory; a project missing from it belongs to no organization. */
class ProjectDirectory implements Pick<ProjectApi, "findOrganizationId"> {
  readonly organizationOf = new Map<string, string>([
    [PROJECT, ORGANIZATION],
    [OTHER_PROJECT, OTHER_ORGANIZATION],
  ]);

  async findOrganizationId(projectId: string): Promise<string | undefined> {
    return this.organizationOf.get(projectId);
  }
}

/** Records each warning as the pino call shape `(fields, message)`. */
class WarningLog {
  readonly lines: { fields: unknown; message: unknown }[] = [];

  warn(fields: unknown, message?: unknown): void {
    this.lines.push({ fields, message });
  }
}

function at(instant: string): number {
  return Temporal.Instant.from(instant).epochMilliseconds;
}

/** A span_received event as trace records it: the aggregate is the trace. */
function spanReceived({
  id,
  projectId,
  traceId,
  createdAt,
}: {
  id: string;
  projectId: string;
  traceId: string;
  createdAt: number;
}): Event {
  return {
    id,
    aggregateId: traceId,
    aggregateType: "trace",
    tenantId: createTenantId(projectId),
    createdAt,
    occurredAt: createdAt,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {},
  };
}

/** The projection over the append service over the memory twin, as the worker composes it. */
function compose() {
  const meter = MemoryTraceMeterRepository.create();
  const log = new WarningLog();
  const projection = TraceMeterProjection.create(
    TraceMeterAppendService.create({ meter, projects: new ProjectDirectory(), logger: log }),
  ).build();
  const deliver = async (event: Event): Promise<void> => {
    const record = projection.map(event);
    if (record) {
      await projection.store.append(record, {
        aggregateId: event.aggregateId,
        tenantId: event.tenantId,
      });
    }
  };
  return { meter, log, deliver };
}

const THIS_MONTH = "2026-03";
const LAST_MONTH = "2026-02";
const MID_MONTH = at("2026-03-10T12:00:00Z");

describe("usage's trace meter", () => {
  describe("given three spans of one trace and one span of another this month", () => {
    describe("when the month's trace count is read for the organization", () => {
      /** @scenario "The trace meter counts each trace once a month however many spans it has" */
      it("counts 2", async () => {
        const { meter, deliver } = compose();
        for (const id of ["evt_1", "evt_2", "evt_3"]) {
          await deliver(
            spanReceived({ id, projectId: PROJECT, traceId: "trace_a", createdAt: MID_MONTH }),
          );
        }
        await deliver(
          spanReceived({
            id: "evt_4",
            projectId: PROJECT,
            traceId: "trace_b",
            createdAt: MID_MONTH,
          }),
        );

        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: THIS_MONTH })).toBe(2);
      });
    });
  });

  describe("given a span of a trace was metered this month", () => {
    describe("when the same span_received event is delivered again", () => {
      /** @scenario "A replayed span does not count its trace twice" */
      it("leaves the month's trace count unchanged", async () => {
        const { meter, deliver } = compose();
        const span = spanReceived({
          id: "evt_1",
          projectId: PROJECT,
          traceId: "trace_a",
          createdAt: MID_MONTH,
        });
        await deliver(span);
        const before = await meter.findTotal({ organizationId: ORGANIZATION, month: THIS_MONTH });

        await deliver(span);

        expect(meter.rows).toHaveLength(2);
        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: THIS_MONTH })).toBe(
          before,
        );
        expect(before).toBe(1);
      });
    });
  });

  describe("given a trace whose first span arrived on the last day of last month", () => {
    describe("when its second span arrives on the first day of this month", () => {
      /** @scenario "A trace counts in the month its first span arrived" */
      it("counts in last month and not in this month", async () => {
        const { meter, deliver } = compose();
        await deliver(
          spanReceived({
            id: "evt_1",
            projectId: PROJECT,
            traceId: "trace_a",
            createdAt: at("2026-02-28T23:59:00Z"),
          }),
        );
        await deliver(
          spanReceived({
            id: "evt_2",
            projectId: PROJECT,
            traceId: "trace_a",
            createdAt: at("2026-03-01T00:01:00Z"),
          }),
        );

        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: LAST_MONTH })).toBe(1);
        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: THIS_MONTH })).toBe(0);
      });
    });
  });

  describe("given another organization's project sent traces this month", () => {
    describe("when the month's trace count is read for the organization", () => {
      /** @scenario "The month's count reads only the organization's own projects" */
      it("does not count the other organization's traces", async () => {
        const { meter, deliver } = compose();
        await deliver(
          spanReceived({
            id: "evt_1",
            projectId: PROJECT,
            traceId: "trace_a",
            createdAt: MID_MONTH,
          }),
        );
        for (const traceId of ["trace_x", "trace_y"]) {
          await deliver(
            spanReceived({
              id: `evt_${traceId}`,
              projectId: OTHER_PROJECT,
              traceId,
              createdAt: MID_MONTH,
            }),
          );
        }

        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: THIS_MONTH })).toBe(1);
        expect(
          await meter.findTotal({ organizationId: OTHER_ORGANIZATION, month: THIS_MONTH }),
        ).toBe(2);
      });
    });
  });

  describe("given a project that belongs to no organization", () => {
    describe("when a span arrives for it", () => {
      /** @scenario "A span from a project in no organization is skipped, loudly" */
      it("writes no trace meter row and logs a warning naming the project", async () => {
        const { meter, log, deliver } = compose();

        await deliver(
          spanReceived({
            id: "evt_1",
            projectId: ORPHAN_PROJECT,
            traceId: "trace_a",
            createdAt: MID_MONTH,
          }),
        );

        expect(meter.rows).toEqual([]);
        expect(log.lines).toEqual([
          {
            fields: { projectId: ORPHAN_PROJECT },
            message: expect.stringContaining("not metered"),
          },
        ]);
      });
    });
  });
});
