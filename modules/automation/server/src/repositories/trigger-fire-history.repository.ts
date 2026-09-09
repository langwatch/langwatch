import type {
  AutomationFireStats,
  TriggerFire,
  TriggerFireStats,
} from "@langwatch/automation-contract";
import type { Instant } from "@langwatch/time";
export abstract class TriggerFireHistoryRepository {
  abstract create(input: {
    projectId: string;
    triggerId: string;
    traceId: string | null;
    customGraphId: string | null;
    createdAt: Instant;
    resolvedAt: Instant | null;
  }): Promise<TriggerFire>;
  abstract findAllStatsForProject(input: {
    projectId: string;
    firesSince: Instant;
  }): Promise<TriggerFireStats[]>;
  abstract findAllRecentByTriggerId(input: {
    projectId: string;
    triggerId: string;
    limit: number;
  }): Promise<TriggerFire[]>;
  abstract findAllRecentForProject(input: {
    projectId: string;
    limit: number;
  }): Promise<TriggerFire[]>;
  /** Compatibility aliases used by the aggregate Automation service. */
  abstract findStats(input: {
    projectId: string;
    firesSince: Instant;
  }): Promise<AutomationFireStats[]>;
  abstract findRecent(input: {
    projectId: string;
    triggerId?: string;
    limit: number;
  }): Promise<TriggerFire[]>;
}
