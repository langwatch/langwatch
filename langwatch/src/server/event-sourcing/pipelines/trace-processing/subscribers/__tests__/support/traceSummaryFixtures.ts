import { vi } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { SPAN_RECEIVED_EVENT_TYPE } from "../../../schemas/constants";
import type { TraceProcessingEvent } from "../../../schemas/events";

/**
 * Fixtures shared by the fold-bound `traceSummary` subscriber tests.
 *
 * Every subscriber mounted on that fold is handed the same three things — the
 * folded state, the committed event, the trigger context — so they are built
 * here once rather than copied into each suite, where the copies drift apart
 * the first time the fold's shape changes.
 */
export const TENANT_ID = "project-123";

export function createFoldState(
  attributes: Record<string, string> = {},
): TraceSummaryData {
  return { attributes } as unknown as TraceSummaryData;
}

export function createEvent(
  tenantId: string,
  aggregateId = "trace-1",
): TraceProcessingEvent {
  return {
    id: "event-1",
    aggregateId,
    aggregateType: "trace",
    tenantId,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: "2025-12-14",
    data: {
      span: {},
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: "STRICT",
    },
    metadata: { spanId: "span-1", traceId: aggregateId },
  } as unknown as TraceProcessingEvent;
}

export function createContext(
  state: TraceSummaryData,
): TriggerContext<TraceSummaryData> {
  return { tenantId: TENANT_ID, aggregateId: "trace-1", state };
}

export function createMockProjectService() {
  return {
    getById: vi.fn(),
    getWithTeam: vi.fn(),
    updateMetadata: vi.fn(),
    isFeatureEnabled: vi.fn(),
    repo: {} as any,
  };
}
