// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Who hears gateway's key facts and what Customer.io is told of them. A payload carries the key's
 * name and id and the budget's figures only: never its secret or prefix, a reason, an end user,
 * a bucket, a budget id, a project or any person's id. A key's first request is a trait only.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import type { CioBatchCall, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import {
  CYCLIC_WINDOWS,
  type RecordBudgetCrossingCommandData,
  type RecordVkFirstRequestCommandData,
  type RecordVkLifecycleCommandData,
} from "@langwatch/gateway-contract";

import {
  isCurrentMembership,
  type NurturingMembership,
} from "./nurturing-organization-member.rules.ts";
import type { NurturingOrganizationAdmin } from "./nurturing-subscription-sync-service.rules.ts";
import { isoOf } from "./nurturing-time.rules.ts";
import type { NurturingVirtualKey } from "./nurturing-virtual-key.rules.ts";

export type VirtualKeyCreatedSignal = NurturingSignalOf<"virtual_key_created">;
export type KeyBudgetThresholdSignal = NurturingSignalOf<"key_budget_threshold">;
export type KeyFirstRequestSignal = NurturingSignalOf<"key_first_request">;
export type GatewayKeySignal =
  | VirtualKeyCreatedSignal
  | KeyBudgetThresholdSignal
  | KeyFirstRequestSignal;

/** Who hears a key fact, and the holders before them whom the member copy holds no row for. */
export type KeyRecipient = Readonly<{
  recipient: string | null;
  passedOverWithoutRow: readonly string[];
}>;

/**
 * The first of the key's holder, its creator and the organization's admin who is a current member
 * of its organization, else no one. Membership is read from nurturing's own copy, disabled rows
 * included, so an id counts only as a person of this organization: no prefix test.
 */
export function pickKeyRecipient({
  organizationId,
  holders,
  memberships,
  admin,
}: Readonly<{
  organizationId: string;
  /** The key's principal, then its creator; null where the fact names none. */
  holders: readonly (string | null)[];
  memberships: readonly NurturingMembership[];
  admin: NurturingOrganizationAdmin;
}>): KeyRecipient {
  const rowsOf = (userId: string) =>
    memberships.filter(
      (membership) => membership.organizationId === organizationId && membership.userId === userId,
    );
  const passedOverWithoutRow: string[] = [];
  for (const userId of holders) {
    if (userId === null) continue;
    const rows = rowsOf(userId);
    if (rows.some(isCurrentMembership)) return { recipient: userId, passedOverWithoutRow };
    if (rows.length === 0) passedOverWithoutRow.push(userId);
  }
  const adminIsCurrent = admin.kind === "admin" && rowsOf(admin.userId).some(isCurrentMembership);
  return { recipient: adminIsCurrent ? admin.userId : null, passedOverWithoutRow };
}

/** When a crossing's period ends as Customer.io is told it; missing when gateway named none. */
export type KeyBudgetPeriodEnd =
  | Readonly<{ outcome: "known"; periodEnd: string | null }>
  | Readonly<{ outcome: "missing" }>;

/**
 * Gateway's own period end as ISO-8601 UTC: nurturing does no date math. A window that never rolls
 * has none. A rolling window whose fact carries none (stored before gateway recorded it) is
 * missing, so the attribute is left out rather than sent as a misleading null.
 */
export function keyBudgetPeriodEndOf({
  window,
  periodEndsAtMs,
}: Readonly<{ window: string; periodEndsAtMs: number | null }>): KeyBudgetPeriodEnd {
  if (periodEndsAtMs !== null) return { outcome: "known", periodEnd: isoOf(periodEndsAtMs) };
  const rolls = (CYCLIC_WINDOWS as readonly string[]).includes(window.toUpperCase());
  return rolls ? { outcome: "missing" } : { outcome: "known", periodEnd: null };
}

/**
 * Whether a crossing is of a key's own budget. An attributed budget names its anchor key too, but
 * each bucket is one end user's spend, not the key's, and end users are none of nurturing's
 * business; organization, project, team, principal and group budgets name no key at all.
 */
export function isKeyOwnBudget(data: RecordBudgetCrossingCommandData): boolean {
  return data.virtual_key_id !== null && data.scope_type.toUpperCase() === "VIRTUAL_KEY";
}

/** A created person's key as its recipient's signal, once per key. */
export function virtualKeyCreatedSignal({
  data,
  userId,
}: Readonly<{ data: RecordVkLifecycleCommandData; userId: string }>): VirtualKeyCreatedSignal {
  const keyPeople = [data.principal_user_id, data.actor_user_id];
  return {
    kind: "virtual_key_created",
    sourceEventId: `${data.virtual_key_id}:created`,
    tenantId: data.tenantId,
    occurredAt: data.occurred_at,
    userId,
    organizationId: data.organization_id,
    virtualKeyId: data.virtual_key_id,
    keyName: data.name,
    recipientHoldsKey: keyPeople.includes(userId),
  };
}

/** A crossing of a copied key's own budget as its recipient's signal, once per kind and period. */
export function keyBudgetThresholdSignal({
  data,
  key,
  userId,
  periodEnd,
}: Readonly<{
  data: RecordBudgetCrossingCommandData;
  key: NurturingVirtualKey;
  userId: string;
  periodEnd: KeyBudgetPeriodEnd;
}>): KeyBudgetThresholdSignal {
  return {
    kind: "key_budget_threshold",
    sourceEventId: `${data.budget_id}:${data.kind}:${data.period_started_at_ms}:${key.virtualKeyId}`,
    tenantId: data.tenantId,
    occurredAt: data.occurred_at,
    userId,
    organizationId: data.organization_id,
    virtualKeyId: key.virtualKeyId,
    keyName: key.name,
    limitUsd: Number(data.limit_usd),
    spentUsd: Number(data.spent_usd),
    reached: data.kind === "breached",
    onBreach: data.on_breach,
    window: data.window.toLowerCase(),
    scopeType: data.scope_type.toLowerCase(),
    ...(periodEnd.outcome === "known" ? { periodEnd: periodEnd.periodEnd } : {}),
  };
}

/** A copied key's first request as its recipient's signal, once per key. */
export function keyFirstRequestSignal({
  data,
  userId,
}: Readonly<{ data: RecordVkFirstRequestCommandData; userId: string }>): KeyFirstRequestSignal {
  return {
    kind: "key_first_request",
    sourceEventId: `${data.virtual_key_id}:first_request`,
    tenantId: data.tenantId,
    occurredAt: data.occurred_at,
    userId,
    organizationId: data.organization_id,
    virtualKeyId: data.virtual_key_id,
  };
}

/** The key's name, id and organization: what every key event carries. */
function keyProperties(
  signal: VirtualKeyCreatedSignal | KeyBudgetThresholdSignal,
): Record<string, unknown> {
  return {
    key_name: signal.keyName,
    virtual_key_id: signal.virtualKeyId,
    organization_id: signal.organizationId,
  };
}

/**
 * The key's holder or maker learns they have a key, a trait only ever set true, then the event
 * that mails it. The admin told in their place gets the event only: the key is not theirs.
 */
export function fireVirtualKeyCreated(signal: VirtualKeyCreatedSignal): CioBatchCall[] {
  const { userId } = signal;
  const track: CioBatchCall = {
    type: "track",
    userId,
    event: "virtual_key_created",
    properties: keyProperties(signal),
  };
  if (!signal.recipientHoldsKey) return [track];
  return [{ type: "identify", userId, traits: { has_virtual_key: true } }, track];
}

/** One event per crossing; `budget_period_end` is left out when gateway named no end. */
export function fireKeyBudgetThreshold(signal: KeyBudgetThresholdSignal): CioBatchCall[] {
  return [
    {
      type: "track",
      userId: signal.userId,
      event: "key_budget_threshold",
      properties: {
        ...keyProperties(signal),
        key_budget: signal.limitUsd,
        key_spend: signal.spentUsd,
        budget_reached: signal.reached,
        on_breach: signal.onBreach,
        window: signal.window,
        scope_type: signal.scopeType,
        ...(signal.periodEnd === undefined ? {} : { budget_period_end: signal.periodEnd }),
      },
    },
  ];
}

/**
 * The person told of the key learns it served a request: a trait only ever set true, so a campaign
 * waiting on it never sees it unset again. No event: nothing mails on it.
 */
export function fireKeyFirstRequest(signal: KeyFirstRequestSignal): CioBatchCall[] {
  return [{ type: "identify", userId: signal.userId, traits: { has_app_request: true } }];
}

/** The calls a gateway key signal makes, in the order they are sent. */
export function fireGatewayKeySignal(signal: GatewayKeySignal): CioBatchCall[] {
  switch (signal.kind) {
    case "virtual_key_created":
      return fireVirtualKeyCreated(signal);
    case "key_budget_threshold":
      return fireKeyBudgetThreshold(signal);
    case "key_first_request":
      return fireKeyFirstRequest(signal);
  }
}
