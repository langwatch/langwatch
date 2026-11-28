import { isTieredPlan, SubscriptionStatus } from "./plan-types.ts";

/** A subscription row as stored, or as a write would leave it, read by the one-live-plan rule. */
export type PlanSlotRow = {
  id: string;
  organizationId: string;
  status: string;
  plan: string;
  stripeSubscriptionId: string | null;
};

/** A subscription write another module sends: `id` names a stored row, absent on a create. */
export type SubscriptionWrite = {
  id?: string | undefined;
  organizationId?: string | undefined;
  status?: string | undefined;
  plan?: string | undefined;
  stripeSubscriptionId?: string | null | undefined;
};

/** An organization a write would leave a second live plan, and the live rows kept beside it. */
export type LivePlanConflict = { organizationId: string; liveSubscriptionIds: string[] };

/**
 * Whether the row takes the organization's one live plan slot: ACTIVE, linked to Stripe and not
 * a tiered plan (a seat checkout goes live before it retires one).
 */
export function holdsLivePlanSlot(row: PlanSlotRow): boolean {
  return (
    row.status === SubscriptionStatus.ACTIVE &&
    row.stripeSubscriptionId !== null &&
    !isTieredPlan(row.plan)
  );
}

/**
 * The rows the writes would leave: an update over its stored row, a create from its own fields.
 * An update naming no stored row writes nothing, so it leaves nothing.
 */
export function writtenPlanSlots({
  stored,
  writes,
}: {
  stored: readonly PlanSlotRow[];
  writes: readonly SubscriptionWrite[];
}): PlanSlotRow[] {
  const created: PlanSlotRow = {
    id: "",
    organizationId: "",
    status: "",
    plan: "",
    stripeSubscriptionId: null,
  };
  return writes.flatMap((write) => {
    const base = write.id === undefined ? created : stored.find((row) => row.id === write.id);
    if (!base) return [];
    return [
      {
        id: base.id,
        organizationId: write.organizationId ?? base.organizationId,
        status: write.status ?? base.status,
        plan: write.plan ?? base.plan,
        stripeSubscriptionId:
          write.stripeSubscriptionId === undefined
            ? base.stripeSubscriptionId
            : write.stripeSubscriptionId,
      },
    ];
  });
}

/** The organizations the written rows would leave with two live plans, given the stored ones. */
export function findLivePlanConflicts({
  rows,
  written,
}: {
  rows: readonly PlanSlotRow[];
  written: readonly PlanSlotRow[];
}): LivePlanConflict[] {
  const writtenIds = new Set(written.map((row) => row.id));
  const writtenSlots = new Map<string, number>();
  for (const row of written.filter(holdsLivePlanSlot)) {
    writtenSlots.set(row.organizationId, (writtenSlots.get(row.organizationId) ?? 0) + 1);
  }
  return [...writtenSlots].flatMap(([organizationId, count]) => {
    const liveSubscriptionIds = rows
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          !writtenIds.has(row.id) &&
          holdsLivePlanSlot(row),
      )
      .map((row) => row.id);
    return liveSubscriptionIds.length > 0 || count > 1
      ? [{ organizationId, liveSubscriptionIds }]
      : [];
  });
}
