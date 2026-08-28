import type { TriggerContext } from "@langwatch/eventing";
import type { TraceProcessingEvent } from "@langwatch/trace-contract";

export type GovernanceTraceSummary = {
  traceId: string;
  occurredAt: number;
  totalCost: number | null;
  totalPromptTokenCount: number | null;
  totalCompletionTokenCount: number | null;
  models: string[];
  attributes: Record<string, string>;
};

/**
 * The event these subscribers actually receive. They mount on the trace
 * pipeline and nowhere else, so `Event<unknown>` understated it: the origin
 * guard discriminates on `type`, and against `unknown` every such check
 * silently compiled while the guard could never narrow. This package already
 * depends on `@langwatch/trace-contract`, so naming the real union costs
 * nothing and is what lets the guard type-check at its call site.
 */
export type GovernanceTraceEvent = TraceProcessingEvent;
export type GovernanceTraceContext = TriggerContext<GovernanceTraceSummary>;

export type GovernanceKpiContribution = {
  tenantId: string;
  sourceId: string;
  sourceType: string;
  hourBucket: Date;
  traceId: string;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  lastEventOccurredAt: Date;
};

export type GovernanceOcsfEvent = {
  tenantId: string;
  eventId: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  activityId: number;
  severityId: number;
  eventTime: Date;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
};

export abstract class GovernanceKpiContributionPort {
  /** Upsert/replacing identity is (tenant, source, hour, trace). */
  abstract insertContribution(row: GovernanceKpiContribution): Promise<void>;
}

export abstract class GovernanceOcsfEventPort {
  /** Upsert/replacing identity is (tenant, eventId). */
  abstract insertEvent(row: GovernanceOcsfEvent): Promise<void>;
}

export abstract class GovernanceSubscriberDiagnosticsPort {
  abstract warn(input: { code: string; tenantId: string; traceId: string }): void;
  abstract capture(error: unknown): void;
}

export type TraceAlertTrigger = {
  id: string;
  action: string;
  actionClass: "notify" | "persist";
  traceDebounceMs: number;
  notificationCadence: string | null;
  hasEvaluationFilters: boolean;
};

export abstract class TraceAlertTriggerPort {
  abstract activeForProject(projectId: string): Promise<TraceAlertTrigger[]>;
}

export abstract class TraceAlertTriggerMatchPort {
  abstract send(input: {
    tenantId: string;
    occurredAt: number;
    triggerId: string;
    traceId: string;
    action: string;
    actionClass: "notify" | "persist";
    traceDebounceMs: number;
    notificationCadence: string | null;
  }): Promise<void>;
}

export abstract class TraceAlertOriginGuardPort {
  abstract passes(input: {
    event: GovernanceTraceEvent;
    state: GovernanceTraceSummary;
  }): boolean;
}

export abstract class TraceAlertMetricsPort {
  abstract countRecorded(count: number): void;
}
