import type {
  GovernanceIngestionSource,
  PulledUsageObservedEventData,
} from "@langwatch/enterprise-governance-contract";
import type { exportTraceServiceRequestSchema } from "@langwatch/trace-contract";
import type { z } from "zod";

export type GovernanceTraceRequest = z.input<typeof exportTraceServiceRequestSchema>;

export abstract class GovernanceTraceIngestionPort {
  abstract ingest(input: { projectId: string; request: GovernanceTraceRequest }): Promise<{
    rejectedSpans: number;
    ingestionFailures: number;
    ingestionFailureMessage?: string;
  }>;
}

export type GovernanceOcsfEventInput = {
  tenantId: string;
  eventId: string;
  traceId: string;
  sourceId: string;
  sourceType: string;
  activityId: 1 | 2 | 3 | 4 | 6;
  severityId: 1 | 3 | 4 | 5 | 6;
  eventTime: Date;
  actorUserId: string;
  actorEmail: string;
  actorEnduserId: string;
  actionName: string;
  targetName: string;
  anomalyAlertId: string;
  rawOcsfJson: string;
};

export abstract class IngestionPullSourcePort {
  abstract tryFindById(id: string): Promise<GovernanceIngestionSource | null>;
}

export abstract class GovernanceOcsfEventSinkPort {
  abstract insertEvent(input: GovernanceOcsfEventInput): Promise<void>;
}

export abstract class PulledUsageDispatcherPort {
  abstract recordPulledUsage(
    input: PulledUsageObservedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

export abstract class PulledUsageEntitlementPort {
  abstract isEnabled(organizationId: string): Promise<boolean>;
}

export abstract class IngestionPullDiagnosticsPort {
  abstract info(message: string, context: Record<string, unknown>): void;
  abstract warn(message: string, context: Record<string, unknown>): void;
  abstract error(message: string, context: Record<string, unknown>): void;
  abstract capture(error: Error, context: Record<string, unknown>): void;
}

export class NullIngestionPullDiagnosticsPort extends IngestionPullDiagnosticsPort {
  info(): void {}
  warn(): void {}
  error(): void {}
  capture(): void {}
}
