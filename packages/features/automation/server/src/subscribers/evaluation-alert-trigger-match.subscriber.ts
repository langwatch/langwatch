import { createLogger } from "@langwatch/observability";
import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";
import type { TraceService } from "@langwatch/trace-contract";
import type {
  AutomationEvaluationTriggerFilterPort,
  AutomationTriggerMatchRecorderPort,
} from "../ports/automation-evaluation-subscriber.port";

const NOTIFY_TRIGGER_ACTIONS = new Set(["SEND_EMAIL", "SEND_SLACK_MESSAGE", "SEND_WEBHOOK"]);

type EvaluationEvent = { occurredAt: number };
type EvaluationState = {
  status: string;
  traceId?: string | null;
};

const logger = createLogger("langwatch:automation:evaluation-alert-trigger-match-subscriber");

interface ActiveTraceTriggerReader {
  getActiveTraceTriggersForProject(projectId: string): Promise<
    Array<{
      id: string;
      action: TriggerMatchRecordedEventData["action"];
      filters: Record<string, unknown>;
      filterQuery: string | null;
      traceDebounceMs: number;
      notificationCadence: TriggerMatchRecordedEventData["notificationCadence"];
    }>
  >;
}

type EvaluationAlertTriggerMatchDeps = {
  automation: ActiveTraceTriggerReader;
  traces: TraceService;
  triggerMatches: AutomationTriggerMatchRecorderPort;
  evaluationFilters: AutomationEvaluationTriggerFilterPort;
};

export async function handleEvaluationAlertTriggerMatch(
  deps: EvaluationAlertTriggerMatchDeps,
  event: EvaluationEvent,
  context: { tenantId: string; state: EvaluationState },
): Promise<void> {
  if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;
  const evaluation = context.state;
  if (
    evaluation.status !== "processed" &&
    evaluation.status !== "error" &&
    evaluation.status !== "skipped"
  ) {
    return;
  }
  if (!evaluation.traceId) return;
  const traceId = evaluation.traceId;
  const traceSummary = await deps.traces.tryGetSummary({
    projectId: context.tenantId,
    traceId,
  });
  if (!traceSummary) {
    logger.debug(
      { tenantId: context.tenantId, traceId },
      "Trace summary not found for evaluation automation match",
    );
    return;
  }
  const triggers = await deps.automation.getActiveTraceTriggersForProject(context.tenantId);
  for (const trigger of triggers.filter((candidate) =>
    deps.evaluationFilters.readsEvaluations(candidate),
  )) {
    // Same idempotency contract as traceAlertTriggerMatch.subscriber: all
    // idempotency-key inputs (triggerId, traceId, occurredAt) derive from
    // the committed event or trigger config — never wall-clock at handling
    // time — so redelivery re-sends identical, store-deduped commands.
    await deps.triggerMatches.send({
      tenantId: context.tenantId,
      occurredAt: event.occurredAt,
      triggerId: trigger.id,
      traceId,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action) ? "notify" : "persist",
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
    });
  }
}
