/**
 * Per scope, the latest change, exact apply, raise and shortening change, keyed
 * `organizationId:scopeType:scopeId`. Each keeps its maximum, so the fold is order-free.
 * Spec: modules/data-retention/specs/retention-apply-record.feature
 */
import type { RetentionScopeType } from "@langwatch/data-retention-contract";
import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";

import {
  retentionApplyStatusKey,
  type ShortenedAtByCategory,
} from "../rules/stored-apply-status.rules.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_POLICY_CHANGED_EVENT_TYPE,
  type RetentionExtensionEvent,
} from "./retention-extension.events.ts";

export const RETENTION_APPLY_STATUS_PROJECTION_NAME = "retentionApplyStatus";
export const RETENTION_APPLY_STATUS_PROJECTION_VERSION = "2026-11-23";

export interface RetentionApplyStatusState {
  readonly organizationId: string;
  readonly scopeType: RetentionScopeType;
  readonly scopeId: string;
  /** Epoch milliseconds, each null until it first happened. */
  readonly changedAt: number | null;
  /** An exact rewrite, which also lowers stamps. */
  readonly appliedAt: number | null;
  /** A rewrite that only raised stamps after a lengthening save. */
  readonly raisedAt: number | null;
  /** A change that kept fewer days than before, so a raise cannot cover it. */
  readonly shortenedAt: number | null;
  /** The same per category, so the drift check defers only the category that was shortened. */
  readonly shortenedAtByCategory: ShortenedAtByCategory | null;
}

const latest = (current: number | null, next: number): number =>
  current === null ? next : Math.max(current, next);

/** The scope an event belongs to; an apply that names none was the organization's. */
function scopeOf(event: RetentionExtensionEvent): {
  organizationId: string;
  scopeType: RetentionScopeType;
  scopeId: string;
} {
  if (event.type === RETENTION_POLICY_CHANGED_EVENT_TYPE) {
    return { organizationId: event.data.organizationId, ...event.data.scope };
  }
  if (event.type === RETENTION_APPLIED_EVENT_TYPE && event.data.scope) {
    return { organizationId: event.data.organizationId, ...event.data.scope };
  }
  const { organizationId } = event.data;
  return { organizationId, scopeType: "ORGANIZATION", scopeId: organizationId };
}

export function applyRetentionApplyStatusEvent(
  state: RetentionApplyStatusState,
  event: RetentionExtensionEvent,
): RetentionApplyStatusState {
  const scope = scopeOf(event);
  const base = { ...state, ...scope };
  switch (event.type) {
    case RETENTION_POLICY_CHANGED_EVENT_TYPE:
      return {
        ...base,
        changedAt: latest(state.changedAt, event.data.changedAt),
        shortenedAt: event.data.shortens
          ? latest(state.shortenedAt, event.data.changedAt)
          : state.shortenedAt,
        shortenedAtByCategory: event.data.shortens
          ? {
              ...state.shortenedAtByCategory,
              [event.data.category]: latest(
                state.shortenedAtByCategory?.[event.data.category] ?? null,
                event.data.changedAt,
              ),
            }
          : state.shortenedAtByCategory,
      };
    case RETENTION_APPLIED_EVENT_TYPE:
      return event.data.mode === "apply"
        ? { ...base, appliedAt: latest(state.appliedAt, event.data.appliedAt) }
        : { ...base, raisedAt: latest(state.raisedAt, event.data.appliedAt) };
    default:
      return state;
  }
}

export function createRetentionApplyStatusProjection(deps: {
  store: StateProjectionStore<RetentionApplyStatusState>;
}): StateProjectionDefinition<RetentionApplyStatusState, RetentionExtensionEvent> {
  return {
    name: RETENTION_APPLY_STATUS_PROJECTION_NAME,
    version: RETENTION_APPLY_STATUS_PROJECTION_VERSION,
    eventTypes: [RETENTION_POLICY_CHANGED_EVENT_TYPE, RETENTION_APPLIED_EVENT_TYPE],
    init: () => ({
      organizationId: "",
      scopeType: "ORGANIZATION",
      scopeId: "",
      changedAt: null,
      appliedAt: null,
      raisedAt: null,
      shortenedAt: null,
      shortenedAtByCategory: null,
    }),
    apply: applyRetentionApplyStatusEvent,
    store: deps.store,
    key: (event) => retentionApplyStatusKey(scopeOf(event)),
  };
}
