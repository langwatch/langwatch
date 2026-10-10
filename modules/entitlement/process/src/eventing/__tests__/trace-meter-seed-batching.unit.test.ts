/**
 * @vitest-environment node
 * Spec: modules/entitlement/specs/usage.feature
 */
import { createTenantId, type Event } from "@langwatch/eventing";
import { Temporal } from "@langwatch/time";
import { SPAN_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceMeterRepository } from "../../repositories/memory/memory.trace-meter.repository.ts";
import type { ProjectPlacement, TenancyRepository } from "../../repositories/tenancy.repository.ts";
import type { TraceMeterRecord } from "../../repositories/trace-meter.repository.ts";
import { TraceMeterAppendService } from "../../services/trace-meter-append.service.ts";
import { TraceMeterProjection } from "../trace-meter.projection.ts";

const ORGANIZATION = "org_1";
const PROJECT = "project_a";
const ORPHAN_PROJECT = "project_orphan";
const MONTH = "2026-03";
const MID_MONTH = Temporal.Instant.from("2026-03-10T12:00:00Z").epochMilliseconds;
/** The replay drain's chunk: one `bulkAppend` per tenant chunk of this size. */
const WRITE_BATCH = 100;

/** Counts every write the meter takes, over the memory twin. */
class CountingMeter extends MemoryTraceMeterRepository {
  inserts = 0;

  static override create(): CountingMeter {
    return new CountingMeter();
  }

  override async insert(input: {
    records: readonly TraceMeterRecord[];
    organizationId: string;
  }): Promise<void> {
    this.inserts += 1;
    await super.insert(input);
  }
}

/** Places PROJECT in ORGANIZATION and counts every lookup. */
class CountingDirectory implements Pick<TenancyRepository, "getProjectPlacement"> {
  lookups = 0;

  async getProjectPlacement({ projectId }: { projectId: string }): Promise<ProjectPlacement> {
    this.lookups += 1;
    return projectId === PROJECT
      ? { kind: "placed", organizationId: ORGANIZATION }
      : { kind: "unplaced" };
  }
}

class WarningLog {
  readonly lines: { fields: unknown; message: unknown }[] = [];

  warn(fields: unknown, message?: unknown): void {
    this.lines.push({ fields, message });
  }
}

function spans({
  projectId,
  traces,
  perTrace,
}: {
  projectId: string;
  traces: number;
  perTrace: number;
}): Event[] {
  return Array.from({ length: traces * perTrace }, (_, index) => ({
    id: `evt_${index}`,
    aggregateId: `trace_${index % traces}`,
    aggregateType: "trace",
    tenantId: createTenantId(projectId),
    createdAt: MID_MONTH,
    occurredAt: MID_MONTH,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {},
  }));
}

/** Replays events through the store's bulk path, one call per tenant chunk as the drain does. */
async function replay({ projectId, events }: { projectId: string; events: Event[] }) {
  const meter = CountingMeter.create();
  const directory = new CountingDirectory();
  const log = new WarningLog();
  const projection = TraceMeterProjection.create(
    TraceMeterAppendService.create({ meter, projects: directory, logger: log }),
  ).build();
  const store = projection.store;
  if (!store.bulkAppend) throw new Error("the trace meter store has no bulk path");
  const records = events.map((event) => TraceMeterProjection.map(event));
  for (let start = 0; start < records.length; start += WRITE_BATCH) {
    await store.bulkAppend(records.slice(start, start + WRITE_BATCH), {
      tenantId: createTenantId(projectId),
    });
  }
  return { meter, directory, log };
}

describe("the trace meter seed's writes", () => {
  describe("given 400 spans of 100 traces of one tenant this month", () => {
    describe("when the seed replays them", () => {
      /** @scenario "The trace meter seed writes a tenant's replayed spans in batches, not one at a time" */
      it("looks the organization up and inserts once per batch, not once per span or trace", async () => {
        const { meter, directory } = await replay({
          projectId: PROJECT,
          events: spans({ projectId: PROJECT, traces: 100, perTrace: 4 }),
        });

        expect(meter.inserts).toBe(4);
        expect(directory.lookups).toBe(4);
        expect(meter.rows).toHaveLength(400);
        expect(await meter.findTotal({ organizationId: ORGANIZATION, month: MONTH })).toBe(100);
      });
    });
  });

  describe("given a project that belongs to no organization", () => {
    describe("when the seed replays a batch of its spans", () => {
      /** @scenario "A replayed batch from a project in no organization is skipped, loudly" */
      it("writes no row and warns once, naming the project", async () => {
        const { meter, log } = await replay({
          projectId: ORPHAN_PROJECT,
          events: spans({ projectId: ORPHAN_PROJECT, traces: 3, perTrace: 2 }),
        });

        expect(meter.inserts).toBe(0);
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
