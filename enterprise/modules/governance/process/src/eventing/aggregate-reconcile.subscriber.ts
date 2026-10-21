// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

import type { AggregateReconcilerService } from "../services/aggregate-reconciler.service.ts";
import type { OutboxAggregateReconcile } from "./aggregate-reconcile.intent.ts";

/** A burst of facts settles this long before one reconcile is queued per key. */
export const AGGREGATE_RECONCILE_SETTLE_MS = 30_000;
/** Outlives the settle, so a fact arriving as the window closes still joins it. */
export const AGGREGATE_RECONCILE_DEDUP_TTL_MS = 60_000;

const organizationKeyOf = z.object({ organizationId: z.string().min(1) });
const projectKeyOf = z.object({ ...organizationKeyOf.shape, projectId: z.string().min(1) });

type AggregateReconcileSettle = {
  delay: number;
  deduplication: { makeId: (event: { data: unknown }) => string; ttlMs: number };
};

/**
 * One job per lane and key in a 30s window, the newest fact replacing older ones (queue default).
 * The key covers what the handler reads: `organization` when it reads only the organisation,
 * `project` when it also reads the project (an archived aggregate retires, a rule names one).
 */
export function settleAggregateReconcile({
  lane,
  per,
}: {
  lane: string;
  per: "organization" | "project";
}): AggregateReconcileSettle {
  return {
    delay: AGGREGATE_RECONCILE_SETTLE_MS,
    deduplication: {
      makeId: (event) => {
        if (per === "organization") {
          return `aggregate-reconcile:${lane}:${organizationKeyOf.parse(event.data).organizationId}`;
        }
        const { organizationId, projectId } = projectKeyOf.parse(event.data);
        return `aggregate-reconcile:${lane}:${organizationId}:${projectId}`;
      },
      ttlMs: AGGREGATE_RECONCILE_DEDUP_TTL_MS,
    },
  };
}

type ProjectFact = { projectId: string; organizationId: string; occurredAt: number };

/**
 * A project created, archived, revived or moved department may change who an aggregate reads:
 * every live aggregate of its organisation is enqueued, and an archived aggregate for retiring.
 * A redelivered fact enqueues under the same keys. Spec: specs/governance/aggregate-project.feature
 */
export function enqueueAffectedAggregates({
  reconciler,
  outbox,
  trigger,
}: {
  reconciler: Pick<AggregateReconcilerService, "aggregatesToReconcile">;
  outbox: Pick<OutboxAggregateReconcile, "enqueue">;
  trigger: string;
}): (fact: ProjectFact) => Promise<void> {
  return async ({ projectId, organizationId, occurredAt }) => {
    const aggregateProjectIds = await reconciler.aggregatesToReconcile({
      organizationId,
      projectId,
    });
    await outbox.enqueue({
      organizationId,
      aggregateProjectIds,
      cause: `${trigger}:${projectId}:${occurredAt}`,
    });
  };
}

/** An aggregate's rule changed: that aggregate alone is enqueued. */
export function enqueueChangedAggregate({
  outbox,
}: {
  outbox: Pick<OutboxAggregateReconcile, "enqueue">;
}): (fact: ProjectFact) => Promise<void> {
  return ({ projectId, organizationId, occurredAt }) =>
    outbox.enqueue({
      organizationId,
      aggregateProjectIds: [projectId],
      cause: `rule-changed:${occurredAt}`,
    });
}

type MemberFact = { organizationId: string; userId: string; occurredAt: number };

/**
 * A member removed or moved department may change who a personal-by-department aggregate reads:
 * every live aggregate of the organisation is enqueued (M8487-DEPT-CHANGE, M8487-OFFBOARD).
 */
export function enqueueMemberAggregates({
  reconciler,
  outbox,
  trigger,
}: {
  reconciler: Pick<AggregateReconcilerService, "aggregatesToReconcile">;
  outbox: Pick<OutboxAggregateReconcile, "enqueue">;
  trigger: string;
}): (fact: MemberFact) => Promise<void> {
  return async ({ organizationId, userId, occurredAt }) => {
    const aggregateProjectIds = await reconciler.aggregatesToReconcile({ organizationId });
    await outbox.enqueue({
      organizationId,
      aggregateProjectIds,
      cause: `${trigger}:${userId}:${occurredAt}`,
    });
  };
}
