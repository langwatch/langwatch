import type { AlertType, Prisma, Trigger, TriggerAction } from "@prisma/client";
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

/** Persisted shape for a trigger upsert. Mirrors the columns the authoring
 *  drawer cares about; runtime-only fields (`active`, `deleted`, `lastRunAt`)
 *  stay under repo control. */
export interface TriggerUpsertInput {
  name: string;
  action: TriggerAction;
  alertType: AlertType | null;
  message: string | null;
  filters: string;
  customGraphId: string | null;
  actionParams: Prisma.InputJsonValue;
  slackTemplateType: string | null;
  slackTemplate: string | null;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
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

  /** Inserts a new Trigger row with the given id. Caller supplies the id so
   *  KSUID generation stays in app-layer / transport — repos persist only. */
  create(params: {
    id: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger>;

  /** Updates an existing Trigger, scoped by projectId so the multi-tenancy
   *  guard rejects cross-project mutations even with a forged triggerId. */
  update(params: {
    triggerId: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger>;
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

  async create(params: {
    id: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger> {
    return {
      id: params.id,
      projectId: params.projectId,
      name: params.data.name,
      action: params.data.action,
      actionParams: params.data.actionParams as Prisma.JsonValue,
      filters: params.data.filters,
      alertType: params.data.alertType,
      message: params.data.message,
      customGraphId: params.data.customGraphId,
      slackTemplateType: params.data.slackTemplateType,
      slackTemplate: params.data.slackTemplate,
      emailSubjectTemplate: params.data.emailSubjectTemplate,
      emailBodyTemplate: params.data.emailBodyTemplate,
      active: true,
      deleted: false,
      lastRunAt: Date.now(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Trigger;
  }

  async update(params: {
    triggerId: string;
    projectId: string;
    data: TriggerUpsertInput;
  }): Promise<Trigger> {
    return {
      id: params.triggerId,
      projectId: params.projectId,
      name: params.data.name,
      action: params.data.action,
      actionParams: params.data.actionParams as Prisma.JsonValue,
      filters: params.data.filters,
      alertType: params.data.alertType,
      message: params.data.message,
      customGraphId: params.data.customGraphId,
      slackTemplateType: params.data.slackTemplateType,
      slackTemplate: params.data.slackTemplate,
      emailSubjectTemplate: params.data.emailSubjectTemplate,
      emailBodyTemplate: params.data.emailBodyTemplate,
      active: true,
      deleted: false,
      lastRunAt: Date.now(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Trigger;
  }
}
