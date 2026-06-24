import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type {
  TriggerSummary,
} from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type {
  GraphEvalStagePayload,
} from "../../../../outbox/payload";
import type { TraceProcessingEvent } from "../../schemas/events";
import { createGraphTriggerEvaluationOutboxReactor } from "../graphTriggerEvaluation.outboxReactor";

// featureFlagService is a process singleton; mock the module so we can
// control `isEnabled` per test.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: vi.fn(),
  },
}));
// eslint-disable-next-line import/order
import { featureFlagService } from "~/server/featureFlag";

const PROJECT_ID = "proj-1";
const TRIGGER_ID_A = "trig-a";
const TRIGGER_ID_B = "trig-b";

function makeGraphTrigger(id: string): TriggerSummary {
  return {
    id,
    projectId: PROJECT_ID,
    name: `Graph ${id}`,
    action: TriggerAction.SEND_EMAIL,
    actionParams: {
      threshold: 10,
      operator: "gt",
      timePeriod: 60,
      seriesName: "0/metadata.trace_id/cardinality",
    },
    filters: {},
    alertType: null,
    message: null,
    customGraphId: `graph-${id}`,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    templates: {
      slackTemplateType: null,
      slackTemplate: null,
      emailSubjectTemplate: null,
      emailBodyTemplate: null,
    },
  };
}

function makeEvent(): TraceProcessingEvent {
  return {
    tenantId: PROJECT_ID,
    aggregateId: "trace-1",
    occurredAt: Date.now(),
  } as unknown as TraceProcessingEvent;
}

function makeContext(): ReactorContext<TraceSummaryData> {
  return {
    tenantId: PROJECT_ID,
    aggregateId: "trace-1",
    foldState: {} as TraceSummaryData,
  } as unknown as ReactorContext<TraceSummaryData>;
}

function makeTriggersStub(
  graphTriggers: TriggerSummary[],
): TriggerService {
  return {
    getActiveTraceTriggersForProject: vi.fn(async () => []),
    getActiveGraphTriggersForProject: vi.fn(async () => graphTriggers),
    claimSend: vi.fn(),
    isSendClaimed: vi.fn(),
    updateLastRunAt: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TriggerService;
}

describe("graphTriggerEvaluation outbox reactor", () => {
  beforeEach(() => {
    vi.mocked(featureFlagService.isEnabled).mockReset();
  });

  describe("when the flag is OFF for the project", () => {
    it("returns no enqueue requests", async () => {
      vi.mocked(featureFlagService.isEnabled).mockResolvedValue(false);
      const triggers = makeTriggersStub([makeGraphTrigger(TRIGGER_ID_A)]);

      const reactor = createGraphTriggerEvaluationOutboxReactor({ triggers });
      const result = await reactor.decide(makeEvent(), makeContext());

      expect(result).toEqual([]);
      expect(triggers.getActiveGraphTriggersForProject).not.toHaveBeenCalled();
    });
  });

  describe("when the flag is ON and there are graph triggers", () => {
    it("enqueues one graphEval payload per active graph trigger", async () => {
      vi.mocked(featureFlagService.isEnabled).mockResolvedValue(true);
      const triggers = makeTriggersStub([
        makeGraphTrigger(TRIGGER_ID_A),
        makeGraphTrigger(TRIGGER_ID_B),
      ]);

      const reactor = createGraphTriggerEvaluationOutboxReactor({ triggers });
      const result = await reactor.decide(makeEvent(), makeContext());

      expect(result).toHaveLength(2);
      const payloadA = result[0]?.payload as unknown as GraphEvalStagePayload;
      const payloadB = result[1]?.payload as unknown as GraphEvalStagePayload;
      expect(payloadA.stage).toBe("graphEval");
      expect(payloadA.reason).toBe("real-time");
      expect(payloadA.triggerId).toBe(TRIGGER_ID_A);
      expect(payloadB.triggerId).toBe(TRIGGER_ID_B);
      expect(result[0]?.enqueueOptions?.ttlMs).toBe(5_000);
      expect(result[0]?.dedupKey).toBe(`${PROJECT_ID}/${TRIGGER_ID_A}:graph`);
      expect(result[1]?.dedupKey).toBe(`${PROJECT_ID}/${TRIGGER_ID_B}:graph`);
    });
  });

  describe("when the flag is ON but there are no graph triggers", () => {
    it("returns no enqueue requests", async () => {
      vi.mocked(featureFlagService.isEnabled).mockResolvedValue(true);
      const triggers = makeTriggersStub([]);

      const reactor = createGraphTriggerEvaluationOutboxReactor({ triggers });
      const result = await reactor.decide(makeEvent(), makeContext());

      expect(result).toEqual([]);
    });
  });

  describe("when the event is older than the replay-flood guard", () => {
    it("returns no enqueue requests without checking the flag", async () => {
      vi.mocked(featureFlagService.isEnabled).mockResolvedValue(true);
      const triggers = makeTriggersStub([makeGraphTrigger(TRIGGER_ID_A)]);

      const oldEvent = {
        ...makeEvent(),
        occurredAt: Date.now() - 2 * 60 * 60 * 1000,
      } as TraceProcessingEvent;

      const reactor = createGraphTriggerEvaluationOutboxReactor({ triggers });
      const result = await reactor.decide(oldEvent, makeContext());

      expect(result).toEqual([]);
      expect(featureFlagService.isEnabled).not.toHaveBeenCalled();
    });
  });
});
