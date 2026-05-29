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

/** The four customer-authored Liquid template columns (see ADR-026). */
export interface TriggerTemplateColumns {
  slackTemplateType: string | null;
  slackTemplate: string | null;
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
}

/**
 * A trigger as the template-authoring surface sees it: identity used to build
 * the preview context, the notification recipients a test fire dispatches to,
 * and the saved template columns. Carries the project name/slug so the renderer
 * can resolve `{{ project.* }}` without a second lookup.
 */
export interface TriggerForTemplating extends TriggerTemplateColumns {
  id: string;
  name: string;
  message: string | null;
  alertType: AlertType | null;
  action: TriggerAction;
  emailRecipients: string[];
  slackWebhook: string | null;
  projectName: string;
  projectSlug: string;
}

/** Only the provided columns are written; `null` clears one back to the default. */
export type TriggerTemplatePatch = Partial<TriggerTemplateColumns>;

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

  /**
   * Loads the template-authoring view of a single trigger (templates,
   * recipients, project identity). Returns null when the trigger does not
   * exist in the project.
   */
  findForTemplating(
    triggerId: string,
    projectId: string,
  ): Promise<TriggerForTemplating | null>;

  /** Writes the provided template columns; omitted columns are left untouched. */
  updateTemplates(params: {
    triggerId: string;
    projectId: string;
    patch: TriggerTemplatePatch;
  }): Promise<void>;
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

  async findForTemplating(
    _triggerId: string,
    _projectId: string,
  ): Promise<TriggerForTemplating | null> {
    return null;
  }

  async updateTemplates(_params: {
    triggerId: string;
    projectId: string;
    patch: TriggerTemplatePatch;
  }): Promise<void> {}
}
