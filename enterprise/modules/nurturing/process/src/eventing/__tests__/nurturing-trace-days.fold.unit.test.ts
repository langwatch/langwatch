// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's trace days as two peer folds on a live eventing runtime: trace's two owner pipelines
 * as stand-ins, the folds over the memory twin, delivered at least once.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSourcing,
  type ReplayEvent,
} from "@langwatch/eventing";
import { EventStoreMemory, testEventSchema } from "@langwatch/eventing/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { SPAN_RECEIVED_EVENT_TYPE, TRACE_FAILED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryNurturingErasedUserRepository } from "../../repositories/memory/memory.nurturing-erased-user.repository.ts";
import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingOrganizationCreatedRepository } from "../../repositories/memory/memory.nurturing-organization-created.repository.ts";
import { MemoryNurturingOrganizationMemberRepository } from "../../repositories/memory/memory.nurturing-organization-member.repository.ts";
import { MemoryNurturingProjectPlacementRepository } from "../../repositories/memory/memory.nurturing-project-placement.repository.ts";
import { MemoryNurturingProjectUsageRepository } from "../../repositories/memory/memory.nurturing-project-usage.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import { traceCountsOf } from "../../rules/nurturing-trace-day.rules.ts";
import { NurturingCopiedProjectsService } from "../../services/nurturing-copied-projects.service.ts";
import { NurturingOrganizationUsageService } from "../../services/nurturing-organization-usage.service.ts";
import {
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME,
  nurturingTraceDayFailuresFold,
  nurturingTraceDaySpansFold,
} from "../nurturing-project-usage.pipeline.ts";
import {
  spanReceived,
  TRACE_MILESTONES_OWNER,
  TRACE_PROCESSING_OWNER,
  traceFailed,
} from "./nurturing-trace-days.test-helpers.ts";

const NOON = Date.UTC(2026, 10, 20, 12);
const SPANS_LANE = `${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.${NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME}`;

/** An owner pipeline as a stand-in: its event type with any data; the fold parses it. */
const ownerOf =
  ({ name, aggregateType }: Readonly<{ name: string; aggregateType: string }>) =>
  (type: string) =>
    definePipeline({ name, aggregate: defineAggregate({ type: aggregateType }) })
      .withEvents([testEventSchema(type, z.unknown())])
      .build();

/** A logged fact as its owner appends it. */
const appended = ({ timestamp: _timestamp, ...fact }: ReplayEvent) => ({
  ...fact,
  tenantId: createTenantId(fact.tenantId),
});

/** A worker of this release: trace's two pipelines as stand-ins, and both trace-day folds. */
function liveWorker() {
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const eventSourcing = new EventSourcing({ eventStore: EventStoreMemory.createForTesting() });
  const spans = eventSourcing.register(ownerOf(TRACE_PROCESSING_OWNER)(SPAN_RECEIVED_EVENT_TYPE));
  const failures = eventSourcing.register(ownerOf(TRACE_MILESTONES_OWNER)(TRACE_FAILED_EVENT_TYPE));
  eventSourcing.register(
    definePipeline({
      name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
    })
      .withEvents([])
      .withPeerFoldProjection(nurturingTraceDaySpansFold(traceDays.forSource("spans")))
      .withPeerFoldProjection(nurturingTraceDayFailuresFold(traceDays.forSource("failures")))
      .build(),
  );
  eventSourcing.startConsumers();
  const record = async (fact: ReplayEvent) => {
    const owner = fact.type === SPAN_RECEIVED_EVENT_TYPE ? spans : failures;
    await owner.service.storeEvents([appended(fact)], { tenantId: createTenantId(fact.tenantId) });
  };
  /** The spans fold's job for `fact` again, as an at-least-once queue may deliver it. */
  const redeliver = (fact: ReplayEvent) =>
    eventSourcing.globalQueue?.send({
      ...appended(fact),
      __pipelineName: "global",
      __jobType: "projection",
      __jobName: SPANS_LANE,
    });
  const days = (projectId = "project-1") =>
    traceDays.findForProjects({ projectIds: [projectId], afterDay: "" });
  return { eventSourcing, traceDays, record, redeliver, days };
}

describe("given the trace-day folds on a live worker", () => {
  /** @scenario "A redelivered span_received folds once" */
  it("folds a redelivered span_received once, and a span stored again under a new id again", async () => {
    const worker = liveWorker();
    const span = spanReceived({ id: "span-1", traceId: "trace-1", createdAt: NOON });
    await worker.record(span);
    await vi.waitFor(async () =>
      expect((await worker.days()).map((day) => day.traceCount)).toEqual([1]),
    );

    await worker.redeliver(span);
    // Same project and day, so the same ordered group: it folds after the redelivery.
    await worker.record(spanReceived({ id: "span-1-again", traceId: "trace-1", createdAt: NOON }));

    await vi.waitFor(async () =>
      expect((await worker.days()).map((day) => day.traceCount)).toEqual([2]),
    );
    await worker.eventSourcing.close();
  });

  /** @scenario "The spans and failures folds keep their own rows of a day, which the read sums" */
  it("keeps a day's spans and failures in rows of their own, which the read sums", async () => {
    const worker = liveWorker();

    await worker.record(spanReceived({ id: "span-1", createdAt: NOON }));
    await worker.record(traceFailed({ id: "trace-1", createdAt: NOON + 1000 }));
    await worker.record(spanReceived({ id: "span-2", createdAt: NOON + 2000 }));

    await vi.waitFor(async () => expect(await worker.days()).toHaveLength(2));
    await vi.waitFor(async () =>
      expect(traceCountsOf({ days: await worker.days(), windowStartDay: "" })).toEqual({
        traceCount: 2,
        errorCount: 1,
        lastTraceAt: NOON + 2000,
        lastFailedTraceAt: NOON + 1000,
        activeDays: ["2026-11-20"],
      }),
    );
    await worker.eventSourcing.close();
  });

  /** @scenario "A trace of a project with no placement copy yet is counted, and syncs once the copy lands" */
  it("counts a trace before its project's copy lands, and syncs it once the copies land", async () => {
    const worker = liveWorker();
    const placements = MemoryNurturingProjectPlacementRepository.create();
    const organizationsCreated = MemoryNurturingOrganizationCreatedRepository.create();
    const milestones = MemoryNurturingMilestonesRepository.create();
    await milestones.recordOrganization({
      organizationId: "org-1",
      adminUserId: "admin-1",
      seeded: false,
    });
    const sent: CioBatchCall[] = [];
    const usage = NurturingOrganizationUsageService.create({
      projectUsage: MemoryNurturingProjectUsageRepository.create(),
      traceDays: worker.traceDays,
      evaluationDays: MemoryNurturingEvaluationDayRepository.create(),
      copiedProjects: NurturingCopiedProjectsService.create({ placements, organizationsCreated }),
      placements,
      organizationsCreated,
      milestones,
      members: MemoryNurturingOrganizationMemberRepository.create(),
      erasedUsers: MemoryNurturingErasedUserRepository.create(),
      claims: MemoryNurturingClaimRepository.create(),
      sendBatch: async (calls) => {
        sent.push(...calls);
      },
      clock: { nowMs: () => NOON + 60_000 },
      logger: createTestLogger().logger,
      syncs: { inc: () => {} },
    });

    await worker.record(spanReceived({ id: "span-1", createdAt: NOON }));
    await vi.waitFor(async () =>
      expect((await worker.days()).map((day) => day.traceCount)).toEqual([1]),
    );
    await usage.tracesChanged({ projectId: "project-1" });
    expect(sent).toEqual([]);

    await placements.recordProject({ projectId: "project-1", organizationId: "org-1" });
    await organizationsCreated.recordOrganizationCreated({
      organizationId: "org-1",
      createdAt: NOON - 86_400_000,
    });
    await usage.tracesChanged({ projectId: "project-1" });

    expect(sent).toEqual([
      expect.objectContaining({
        type: "group",
        groupId: "org-1",
        traits: expect.objectContaining({ trace_count: 1 }),
      }),
    ]);
    await worker.eventSourcing.close();
  });
});
