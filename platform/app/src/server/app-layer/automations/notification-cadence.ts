import type { NotificationCadence } from "@langwatch/automations/cadences";
import type { TriggerAction } from "@prisma/client";
import { NOTIFY_TRIGGER_ACTIONS } from "./dispatch/triggerActionDispatch";

/**
 * The cadence a newly saved automation runs on (ADR-026).
 *
 * Cadence applies to notify channels only. A new notification automation
 * starts on a five-minute digest, which is what keeps a broad condition from
 * turning into a message per matching trace; anything that writes rather than
 * notifies — a dataset row, an annotation-queue item — is pinned to immediate
 * at the storage boundary so a stale value cannot reach the dispatch path. A
 * graph alert is incident-based (it fires on breach, stays quiet while open
 * and resolves on recovery), so there is nothing to digest and it pins to
 * immediate as well.
 *
 * Lives in the app layer because every write path owes the same answer: the
 * dashboard save, and any automation written over the public API. Both call
 * these two functions — there is no second copy of the rule.
 */
export function resolveNotificationCadenceForCreate({
  action,
  requested,
  isGraphAlert = false,
}: {
  action: TriggerAction;
  requested?: NotificationCadence;
  isGraphAlert?: boolean;
}): NotificationCadence {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  if (isGraphAlert) return "immediate";
  return requested ?? "5min_digest";
}

/**
 * The cadence an edited automation runs on, or `undefined` to leave the stored
 * one alone.
 *
 * The pinned classes answer with a value rather than with `undefined` on
 * purpose. An automation edited from a notify channel to one that writes keeps
 * its digest cadence on the row unless the edit overwrites it, and the row
 * would then claim a cadence the dispatch path no longer reads. Stating
 * `immediate` on every such save keeps the stored value true.
 */
export function resolveNotificationCadenceForUpdate({
  action,
  requested,
  isGraphAlert = false,
}: {
  action: TriggerAction;
  requested?: NotificationCadence;
  isGraphAlert?: boolean;
}): NotificationCadence | undefined {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  if (isGraphAlert) return "immediate";
  return requested;
}
