/**
 * Per scope, the latest change saved there and the latest apply that scope asked for, keyed
 * `organizationId:scopeType:scopeId`. Both keep their maximum, so the fold is order-free.
 * Spec: modules/data-retention/specs/retention-apply-record.feature
 */
import type { RetentionScopeType } from "@langwatch/data-retention-contract";
import type { StateProjectionDefinition, StateProjectionStore } from "@langwatch/eventing";

import { retentionApplyStatusKey } from "../rules/stored-apply-status.rules.ts";
import {
  RETENTION_APPLIED_EVENT_TYPE,
  RETENTION_POLICY_CHANGED_EVENT_TYPE,
  type RetentionExtensionEvent,
} from "./retention-extension.events.ts";

export const RETENTION_APPLY_STATUS_PROJECTION_NAME = "retentionApplyStatus";
export const RETENTION_APPLY_STATUS_PROJECTION_VERSION = "2026-11-22";

export interface RetentionApplyStatusState {
  readonly organizationId: string;
  readonly scopeType: RetentionScopeType;
  readonly scopeId: string;
  /** Epoch milliseconds, each null until it first happened. */
  readonly changedAt: number | null;
  readonly appliedAt: number | null;
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
      return { ...base, changedAt: latest(state.changedAt, event.data.changedAt) };
    case RETENTION_APPLIED_EVENT_TYPE:
      return { ...base, appliedAt: latest(state.appliedAt, event.data.appliedAt) };
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
    }),
    apply: applyRetentionApplyStatusEvent,
    store: deps.store,
    key: (event) => retentionApplyStatusKey(scopeOf(event)),
  };
}
