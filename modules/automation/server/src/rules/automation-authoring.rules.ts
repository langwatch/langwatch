/**
 * The authoring decisions that need nothing but their arguments: which filter
 * fields this platform still evaluates, what cadence a saved automation is
 * pinned to, whether a recipient list is well formed, and which stored webhook
 * headers a "keep what is there" sentinel resolves to.
 */
import {
  automationFilterFieldSchema,
  EMAIL_RX,
  InvalidEmailRecipientError,
  NOTIFY_TRIGGER_ACTIONS,
  TriggerActionUnsupportedError,
  WEBHOOK_HEADER_VALUE_KEPT,
  type AutomationAction,
  type AutomationFilters,
  type BuildGraphAlertTriggerDataInput,
  type NotificationCadence,
} from "@langwatch/automation-contract";

/** The three prefixes a filter key uses to name the monitor it is about. */
const MONITOR_FILTER_PREFIXES = ["check_", "eval_", "evaluation_"] as const;

/**
 * The monitor ids a filter set names. A filter object nests, and the ids sit on
 * the keys rather than the values, so the whole structure is walked. Arrays are
 * left alone: their entries are selected values, never further filter fields.
 */
export function extractCheckKeys(inputObject: Record<string, unknown>): string[] {
  const keys: string[] = [];

  const recurse = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      const namesMonitor = MONITOR_FILTER_PREFIXES.some((prefix) => key.startsWith(prefix));

      if (namesMonitor) keys.push(key);

      const value = obj[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        recurse(value as Record<string, unknown>);
      }
    }
  };

  recurse(inputObject);

  return keys;
}

const KNOWN_FILTER_FIELDS = new Set<string>(automationFilterFieldSchema.options);

/**
 * Splits an author's filter set into the fields this platform still supports
 * and the ones it no longer does. The unknown names are kept rather than
 * dropped silently: an automation whose every condition is legacy would
 * otherwise save as "matches everything".
 */
export function partitionFilterFields(filters: Record<string, unknown>): {
  sanitized: AutomationFilters;
  unknownFields: string[];
} {
  const sanitized: Record<string, unknown> = {};
  const unknownFields: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (KNOWN_FILTER_FIELDS.has(key)) {
      sanitized[key] = value;
    } else {
      unknownFields.push(key);
    }
  }

  return { sanitized: sanitized as AutomationFilters, unknownFields };
}

/**
 * ADR-026: cadence applies to notify actions only. New notify triggers default
 * to a 5-minute digest (operator-friendly storm protection); persist actions
 * are pinned to immediate at the storage boundary so a stale value can't leak
 * into the dispatch path. Graph alerts are incident-based - fire on breach,
 * silent while open, resolve on recovery - so there is nothing to digest.
 */
export function resolveCadenceForCreate(
  action: AutomationAction,
  requested: NotificationCadence | undefined,
  isGraphAlert = false,
): NotificationCadence {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  if (isGraphAlert) return "immediate";

  return requested ?? "5min_digest";
}

/**
 * Persist actions always pin to `immediate`. Returning `undefined` when the
 * client omits the field would skip the column update and leak a stale
 * notify-class cadence onto a row edited from notify to persist, so the
 * boundary invariant is forced on every update.
 */
export function resolveCadenceForUpdate(
  action: AutomationAction,
  requested: NotificationCadence | undefined,
  isGraphAlert = false,
): NotificationCadence | undefined {
  if (!NOTIFY_TRIGGER_ACTIONS.has(action)) return "immediate";
  if (isGraphAlert) return "immediate";

  return requested;
}

/**
 * Validates recipient addresses by RFC shape only - external addresses are
 * intentionally allowed (Slack's "email to a channel" pattern, partner
 * inboxes). The UI surfaces an "External" warning badge for non-team addresses
 * so operators know what they are shipping.
 */
export function validateEmailRecipientFormats(recipients: readonly string[]): void {
  for (const email of recipients) {
    if (!EMAIL_RX.test(email)) {
      throw new InvalidEmailRecipientError(email);
    }
  }
}

/**
 * Resolves the sentinel `WEBHOOK_HEADER_VALUE_KEPT` value on each header to the
 * saved (decrypted) value, dropping the header when nothing was saved under
 * that name; every other header passes through unchanged.
 */
export function resolveKeptWebhookHeaders(
  headers: Record<string, string>,
  saved: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    if (value === WEBHOOK_HEADER_VALUE_KEPT) {
      if (saved[name] !== undefined) resolved[name] = saved[name];
      continue;
    }
    resolved[name] = value;
  }

  return resolved;
}

/** A graph alert or a report delivers a notification; there is no persist form. */
export function notifyingActionOr(
  action: BuildGraphAlertTriggerDataInput["action"] | "ADD_TO_DATASET" | "ADD_TO_ANNOTATION_QUEUE",
  triggerKind: "graph alert" | "report",
): BuildGraphAlertTriggerDataInput["action"] {
  if (action === "ADD_TO_DATASET" || action === "ADD_TO_ANNOTATION_QUEUE") {
    throw new TriggerActionUnsupportedError(triggerKind, action);
  }

  return action;
}
