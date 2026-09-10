import type {
  CustomGraph,
  EmailSuppression,
  Trigger,
  TriggerFire,
  WebhookDeliveryRow,
} from "@langwatch/automation-contract";
import type { AnalyticsMetricSource } from "../graph-trigger-sent.repository.ts";

/** One claimed send: the row `claimSend` writes once per trigger and trace. */
export interface StoredTriggerSend {
  triggerId: string;
  traceId: string;
  projectId: string;
}

/** One graph-alert incident, open until it is resolved or the claim is dropped. */
export interface StoredGraphTriggerSent {
  id: string;
  triggerId: string;
  projectId: string;
  customGraphId: string;
  source: AnalyticsMetricSource | undefined;
  resolvedAt: Date | null;
}

/** One webhook attempt, with the project it belongs to beside the wire row. */
export interface StoredWebhookDelivery {
  projectId: string;
  row: WebhookDeliveryRow;
}

/**
 * The one store every memory automation repository reads and writes, so a row
 * one of them writes is the row the next one answers from - the way one
 * database serves them all.
 */
export class MemoryAutomationStore {
  static create(): MemoryAutomationStore {
    return new MemoryAutomationStore();
  }

  readonly triggers = new Map<string, Trigger>();
  readonly sends: StoredTriggerSend[] = [];
  readonly fires: (TriggerFire & { projectId: string })[] = [];
  readonly suppressions: EmailSuppression[] = [];
  readonly customGraphs: (CustomGraph & { dashboardId: string | null })[] = [];
  readonly webhookDeliveries: StoredWebhookDelivery[] = [];
  readonly graphTriggerSent: StoredGraphTriggerSent[] = [];
  /** The project names an unsubscribe page renders, by project id. */
  readonly projectNames = new Map<string, string>();
}
