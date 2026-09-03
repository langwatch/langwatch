import type {
  NotificationCadence,
  TriggerAction,
  TriggerSummary,
} from "@langwatch/automation-contract";
import {
  triggerFiltersNeedEvaluation,
  NOTIFY_TRIGGER_ACTIONS,
} from "@langwatch/automation-contract";
import {
  AutomationTraceTriggerCataloguePort,
  type AutomationTriggerMatchRecorderPort,
} from "@langwatch/automation-server";
import type { TriggerContext } from "@langwatch/eventing";
import {
  OtelTraceAlertMetricsAdapter,
  TraceAlertOriginGuardPort,
  TraceAlertTriggerMatchPort,
  TraceAlertTriggerMatchSubscriber,
  TraceAlertTriggerPort,
  type GovernanceTraceEvent,
  type GovernanceTraceSummary,
  type TraceAlertTrigger,
} from "@langwatch/enterprise-governance-server";
import type { TraceProcessingEvent, TraceSummaryData } from "@langwatch/trace-contract";
import { passesTraceOriginGuards } from "@langwatch/trace-server";

/**
 * The trace-alert half of `reactor:triggerMatch`, composed in this process.
 *
 * WHAT THIS KEY DOES, because "trigger match" understates it: for every trace
 * that lands, it asks which of the project's automations watch traces and
 * writes one durable MATCH per automation. The settlement process manager
 * downstream turns those matches into the customer's alert — one mail per
 * window rather than one per trace. A process that mounted the trace pipeline
 * without this key would route every other kind of trace work and silently stop
 * every alert a customer had configured.
 *
 *     triggerMatchHandler
 *       └─ TraceAlertTriggerMatchSubscriber   (enterprise governance owns it)
 *            ├─ TraceAlertOriginGuardPort     packaged `passesTraceOriginGuards`
 *            ├─ TraceAlertTriggerPort         the project's trace automations
 *            │    └─ AutomationTraceTriggerCataloguePort   one cached read
 *            ├─ TraceAlertTriggerMatchPort    one durable match
 *            │    └─ the installer's `recordTriggerMatch` proxy
 *            └─ TraceAlertMetricsPort         the fleet's match counter
 *
 * THREE BLOCKERS ARE CLEARED HERE, and each was a different kind. The catalogue
 * read was `AutomationService`, whose constructor asks for twelve collaborators
 * because its WRITE half needs them; it is now one narrow port. The match write
 * was the automation pipeline's own command, which this process already
 * publishes as a late-bound recorder. And the subscriber itself lived behind an
 * application-private runtime class; it is composed from the governance
 * package directly, so nothing here needs the application's error sink or its
 * prom-client registry.
 *
 * THE ACTION CLASSIFICATION IS THE FEATURE'S OWN. `notify` and `persist` decide
 * whether settlement debounces the match into a window or writes it through
 * immediately, and the set that splits them is `NOTIFY_TRIGGER_ACTIONS` from
 * the automation contract rather than a list repeated here — a fourth notify
 * action added upstream would otherwise be classified as a persist and fire on
 * every single trace.
 */
export function createWorkerTraceAlertTriggerHandler(options: {
  triggers: AutomationTraceTriggerCataloguePort;
  matches: AutomationTriggerMatchRecorderPort;
}): (event: TraceProcessingEvent, context: TriggerContext<TraceSummaryData>) => Promise<void> {
  const subscriber = TraceAlertTriggerMatchSubscriber.create({
    triggers: new WorkerTraceAlertTriggerAdapter(options.triggers),
    matches: new WorkerTraceAlertTriggerMatchAdapter(options.matches),
    originGuard: new WorkerTraceAlertOriginGuardAdapter(),
    metrics: OtelTraceAlertMetricsAdapter.create(),
  });

  return (event, context) =>
    subscriber.handle(event, context as TriggerContext<GovernanceTraceSummary>);
}

/**
 * Renames a project's trace automations onto the shape the subscriber reads.
 *
 * The explicit return type is load-bearing: without it `actionClass` widens to
 * `string` and this stops satisfying the port, which the compiler would report
 * far from here.
 */
class WorkerTraceAlertTriggerAdapter extends TraceAlertTriggerPort {
  constructor(private readonly catalogue: AutomationTraceTriggerCataloguePort) {
    super();
  }

  async activeForProject(projectId: string): Promise<TraceAlertTrigger[]> {
    const triggers = await this.catalogue.getActiveTraceTriggersForProject(projectId);
    return triggers.map((trigger: TriggerSummary) => ({
      id: trigger.id,
      action: trigger.action,
      actionClass: NOTIFY_TRIGGER_ACTIONS.has(trigger.action)
        ? ("notify" as const)
        : ("persist" as const),
      traceDebounceMs: trigger.traceDebounceMs,
      notificationCadence: trigger.notificationCadence,
      // An automation whose condition can only be answered after an evaluation
      // is left to the evaluation pipeline. Matching it here would test a
      // result that does not exist yet, so it would never fire at all.
      hasEvaluationFilters: triggerFiltersNeedEvaluation(trigger.filters),
    }));
  }
}

/**
 * Writes one durable match through the automation pipeline's own command.
 *
 * THE TWO CASTS ARE A ROUND TRIP, not a widening. `action` and
 * `notificationCadence` leave the automation contract as literal unions,
 * cross the governance port as `string` — the port is written that way because
 * governance must not depend on Automation's vocabulary — and arrive back at
 * Automation's own command, which names the unions again. The values are the
 * ones `activeForProject` read off the project's own rows a few lines above,
 * so nothing unvalidated enters here; what is restored is the type the value
 * never stopped having.
 */
class WorkerTraceAlertTriggerMatchAdapter extends TraceAlertTriggerMatchPort {
  constructor(private readonly matches: AutomationTriggerMatchRecorderPort) {
    super();
  }

  async send(input: {
    tenantId: string;
    occurredAt: number;
    triggerId: string;
    traceId: string;
    action: string;
    actionClass: "notify" | "persist";
    traceDebounceMs: number;
    notificationCadence: string | null;
  }): Promise<void> {
    await this.matches.send({
      ...input,
      action: input.action as TriggerAction,
      notificationCadence: input.notificationCadence as NotificationCadence,
    });
  }
}

/**
 * The same origin guard every other trace subscriber runs behind.
 *
 * It is the package's own function rather than a re-statement, and that matters
 * for one reason above the rest: it is what keeps a topic-clustering re-emit
 * over thousands of historical traces from re-firing every alert a customer has
 * ever configured.
 */
class WorkerTraceAlertOriginGuardAdapter extends TraceAlertOriginGuardPort {
  passes(input: { event: GovernanceTraceEvent; state: GovernanceTraceSummary }): boolean {
    return passesTraceOriginGuards(input.event, input.state as TraceSummaryData);
  }
}
