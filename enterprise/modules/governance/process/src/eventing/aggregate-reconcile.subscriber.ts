// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { AggregateReconcilerService } from "../services/aggregate-reconciler.service.ts";
import type { OutboxAggregateReconcile } from "./aggregate-reconcile.intent.ts";

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
