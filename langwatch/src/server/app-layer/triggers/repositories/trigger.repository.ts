import type { AlertType, TriggerAction } from "@prisma/client";
import type { TriggerFilters } from "~/server/filters/types";

export interface TriggerSummary {
  id: string;
  projectId: string;
  name: string;
  action: TriggerAction;
  actionParams: unknown;
  filters: TriggerFilters;
  alertType: AlertType | null;
  message: string | null;
  customGraphId: string | null;
}

export interface TriggerRepository {
  findActiveForProject(projectId: string): Promise<TriggerSummary[]>;

  /** Returns true if a TriggerSent record exists for this trigger + trace pair. */
  hasSentForTrace(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /** Records that a trigger fired for a trace (idempotent — skips duplicates). */
  recordSent(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<void>;

  /** Updates the trigger's lastRunAt timestamp. */
  updateLastRunAt(triggerId: string, projectId: string): Promise<void>;
}

export class NullTriggerRepository implements TriggerRepository {
  async findActiveForProject(_projectId: string): Promise<TriggerSummary[]> {
    return [];
  }

  async hasSentForTrace(_params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return false;
  }

  async recordSent(_params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<void> {}

  async updateLastRunAt(
    _triggerId: string,
    _projectId: string,
  ): Promise<void> {}
}
