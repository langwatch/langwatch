/** Spec: modules/entitlement/specs/usage.feature */
import { describe, expect, it } from "vitest";

import { MemoryTraceCountRepository } from "../../repositories/memory/memory.trace-count.repository.ts";
import { TraceUsageService } from "../../services/trace-usage.service.ts";
import {
  traceUsageMonthIdsSubscriber,
  traceUsageSpanSubscriber,
} from "../trace-usage.subscriber.ts";

const ORGANIZATION = "organization-1";
const OCT_8 = Date.UTC(2026, 9, 8, 12);

function compose() {
  const counts = MemoryTraceCountRepository.create();
  const usage = TraceUsageService.create({
    counts,
    projects: {
      getProjectPlacement: async () => ({ kind: "placed" as const, organizationId: ORGANIZATION }),
    },
  });
  return { counts, usage };
}

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "trace-1",
  occurredAt: OCT_8,
  createdAt: OCT_8,
  eventId: "event-1",
};

describe("trace usage subscribers on redelivery", () => {
  /** @scenario "The month counts distinct traces, however often each was written" */
  it("leaves one row and one counted trace when a span job is delivered twice", async () => {
    const { counts, usage } = compose();
    const subscriber = traceUsageSpanSubscriber(usage);

    await subscriber.handle({}, CONTEXT);
    await subscriber.handle({}, CONTEXT);

    expect(counts.rows).toHaveLength(1);
    await expect(
      counts.findTotal({ organizationId: ORGANIZATION, month: "2026-10" }),
    ).resolves.toBe(1);
  });

  /** @scenario "The month counts distinct traces, however often each was written" */
  it("leaves one row per trace when the upgrade's page is delivered twice", async () => {
    const { counts, usage } = compose();
    const subscriber = traceUsageMonthIdsSubscriber(usage);
    const page = {
      tenantId: "project-1",
      projectId: "project-1",
      month: "2026-10",
      traceIds: ["trace-1", "trace-2"],
    };

    await subscriber.handle(page, { ...CONTEXT, aggregateId: "project-1" });
    await subscriber.handle(page, { ...CONTEXT, aggregateId: "project-1" });

    expect(counts.rows).toHaveLength(2);
    await expect(
      counts.findTotal({ organizationId: ORGANIZATION, month: "2026-10" }),
    ).resolves.toBe(2);
  });
});
