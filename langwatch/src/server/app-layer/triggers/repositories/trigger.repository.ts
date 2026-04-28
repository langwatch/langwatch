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

  /**
   * Atomically claim ownership of (triggerId, traceId). Inserts a
   * TriggerSent row using the unique (triggerId, traceId) constraint.
   * Returns true iff this caller is the first to claim the pair —
   * at-most-once dispatch is built on top of this guarantee. Concurrent
   * reactors (trace-processing + evaluation-processing) racing on the
   * same trigger/trace will each see exactly one `true`.
   */
  claimSend(params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean>;

  /** Updates the trigger's lastRunAt timestamp. */
  updateLastRunAt(triggerId: string, projectId: string): Promise<void>;
}

export class NullTriggerRepository implements TriggerRepository {
  async findActiveForProject(_projectId: string): Promise<TriggerSummary[]> {
    return [];
  }

  async claimSend(_params: {
    triggerId: string;
    traceId: string;
    projectId: string;
  }): Promise<boolean> {
    return true;
  }

  async updateLastRunAt(
    _triggerId: string,
    _projectId: string,
  ): Promise<void> {}
}
