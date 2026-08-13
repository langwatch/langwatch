import { nanoid } from "nanoid";
import {
  type AlertType,
  type Prisma,
  type Trigger,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { featureFlagService } from "~/server/featureFlag";
import { hasActionableTriggerFilters } from "~/server/filters/triggerFilter.matcher";
import {
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import {
  TriggerChannelNotEnabledError,
  TriggerFiltersRequiredError,
  TriggerFiltersUnsupportedError,
  TriggerNotFoundError,
} from "./errors";
import { resolveNotificationCadenceForCreate } from "./notification-cadence";
import type { TriggerService } from "./trigger.service";
import { persistPublicApiActionParams } from "./trigger-redaction";

/**
 * What the public API is allowed to write, and on what terms.
 *
 * An automation written over the API is the same row the dashboard writes and
 * the same row the dispatcher reads, so it is held to the same rules rather
 * than to whatever the wire schema happened to accept: a delivery
 * configuration its channel recognises, a destination that is safe to send to,
 * a channel this project has, conditions that select something, and the
 * cadence a new notification starts on.
 *
 * The channel a trigger delivers on is fixed once it is created. An update
 * states a delivery configuration for the channel already stored, which is
 * what lets the credential rules read the incoming and stored halves as
 * belonging to one provider (see `trigger-redaction.ts`).
 */
export class PublicApiTriggerService {
  constructor(private readonly triggers: TriggerService) {}

  /** Every automation in the project, paused ones included. */
  async getAll({ projectId }: { projectId: string }): Promise<Trigger[]> {
    return this.triggers.getAllForProject({ projectId });
  }

  async getById({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    const trigger = await this.triggers.getById({ triggerId, projectId });
    if (!trigger || trigger.deleted) throw new TriggerNotFoundError();
    return trigger;
  }

  async create({
    projectId,
    input,
  }: {
    projectId: string;
    input: {
      name: string;
      action: TriggerAction;
      actionParams: Record<string, unknown>;
      filters?: Record<string, TriggerFilterValue>;
      message?: string;
      alertType?: AlertType;
    };
  }): Promise<Trigger> {
    await this.assertChannelEnabled({ action: input.action, projectId });

    // This route writes trace automations — it carries no graph or report
    // shape — so a condition that selects something is always required.
    const filters = this.sanitizeFilters(input.filters ?? {});
    if (!hasActionableTriggerFilters(filters)) {
      throw new TriggerFiltersRequiredError();
    }

    const actionParams = await persistPublicApiActionParams({
      action: input.action,
      incoming: input.actionParams,
    });

    const trigger = await this.triggers.create({
      data: {
        id: nanoid(),
        projectId,
        name: input.name,
        action: input.action,
        actionParams: actionParams as Prisma.InputJsonValue,
        filters: JSON.stringify(filters),
        triggerKind: TriggerKind.AUTOMATION,
        notificationCadence: resolveNotificationCadenceForCreate({
          action: input.action,
        }),
        lastRunAt: new Date().getTime(),
        message: input.message ?? null,
        alertType: input.alertType ?? null,
      },
    });

    await this.triggers.invalidate(projectId);
    return trigger;
  }

  async update({
    projectId,
    triggerId,
    input,
  }: {
    projectId: string;
    triggerId: string;
    input: {
      name?: string;
      active?: boolean;
      message?: string | null;
      alertType?: AlertType | null;
      filters?: Record<string, TriggerFilterValue>;
      actionParams?: Record<string, unknown>;
    };
  }): Promise<Trigger> {
    const stored = await this.getById({ projectId, triggerId });

    const data: Prisma.TriggerUncheckedUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.message !== undefined) data.message = input.message;
    if (input.alertType !== undefined) data.alertType = input.alertType;

    if (input.filters !== undefined) {
      const filters = this.sanitizeFilters(input.filters);
      // Editing is the other way to end up with a match-everything automation:
      // create it with a real condition, then clear it here. The stored row
      // decides whether that is allowed — an automation whose condition lives
      // in its query keeps a legitimately empty structured set, and alerts and
      // reports have no trace condition to require at all.
      if (
        !hasActionableTriggerFilters(filters) &&
        stored.triggerKind === TriggerKind.AUTOMATION &&
        (stored.filterQuery ?? "").trim() === ""
      ) {
        throw new TriggerFiltersRequiredError();
      }
      data.filters = JSON.stringify(filters);
    }

    if (input.actionParams !== undefined) {
      // The channel is the stored row's: an update states a delivery
      // configuration for the channel this automation already delivers on.
      await this.assertChannelEnabled({ action: stored.action, projectId });
      data.actionParams = (await persistPublicApiActionParams({
        action: stored.action,
        incoming: input.actionParams,
        stored: stored.actionParams,
      })) as Prisma.InputJsonValue;
    }

    const updated = await this.triggers.update({ triggerId, projectId, data });
    await this.triggers.invalidate(projectId);
    return updated;
  }

  async softDelete({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<Trigger> {
    await this.getById({ projectId, triggerId });
    const deleted = await this.triggers.softDeleteById({
      triggerId,
      projectId,
    });
    await this.triggers.invalidate(projectId);
    return deleted;
  }

  /** Conditions naming fields this platform no longer filters on are dropped.
   *  An automation left with nothing but those has no usable condition at all,
   *  which is a different answer from having written none. */
  private sanitizeFilters(
    filters: Record<string, TriggerFilterValue>,
  ): Record<string, TriggerFilterValue> {
    const { sanitized, unknownFields } = sanitizeTriggerFilters(filters);
    if (unknownFields.length > 0 && Object.keys(sanitized).length === 0) {
      throw new TriggerFiltersUnsupportedError(unknownFields);
    }
    return sanitized;
  }

  /** The webhook channel ships behind a release flag (ADR-040 §7). Gating the
   *  save and not only the picker is what makes the flag hold for a caller who
   *  never sees the picker. */
  private async assertChannelEnabled({
    action,
    projectId,
  }: {
    action: TriggerAction;
    projectId: string;
  }): Promise<void> {
    if (action !== TriggerAction.SEND_WEBHOOK) return;
    const enabled = await featureFlagService.isEnabled(
      "release_webhook_automations",
      { distinctId: projectId, projectId },
    );
    if (!enabled) throw new TriggerChannelNotEnabledError("webhook");
  }
}
