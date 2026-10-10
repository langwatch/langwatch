// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { SYSTEM_ACTORS } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type {
  AggregateRule,
  LiveAggregate,
  ProjectApi,
  StoredAggregateProject,
} from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

import type { AggregateReconcileLockRepository } from "../repositories/aggregate-reconcile-lock.repository.ts";
import { decideAggregateMembership } from "../rules/aggregate-membership.rules.ts";

const logger = createLogger("langwatch:governance:aggregate-reconciler");

/** The revocation reason a reconciler-revoked shared read carries. */
export const AGGREGATE_RULE_NO_LONGER_MATCHES = "aggregate_rule_no_longer_matches";

/** The revocation reason every shared read of an archived aggregate carries. */
export const AGGREGATE_ARCHIVED = "aggregate_archived";

/** Member project ids, each in one list; a `failed` attach is tried again by the next reconcile. */
type AggregateReconcileResult = {
  attached: string[];
  revoked: string[];
  unchanged: string[];
  failed: string[];
};

const NOTHING: AggregateReconcileResult = { attached: [], revoked: [], unchanged: [], failed: [] };

const ACTOR = { type: "system", id: SYSTEM_ACTORS.aggregateReconciler } as const;

type AggregateReconcilerDependencies = {
  lock: AggregateReconcileLockRepository;
  projects: Pick<
    ProjectApi,
    | "findAggregate"
    | "findLiveAggregateIds"
    | "findAllLiveAggregates"
    | "findPersonalProjectIds"
    | "findReadableProjectIds"
  >;
  organizations: Pick<OrganizationApi, "findMembersWithDepartments">;
  grants: Pick<
    AuthzApi,
    | "findLiveSharedProjectGrants"
    | "attachSharedProjectGrant"
    | "awaitSharedProjectGrants"
    | "revokeSharedProjectGrants"
  >;
  now: () => Instant;
};

/**
 * ADR-177 decision 3 (main's AggregateReconciler): one live shared trace read per member the
 * aggregate's rule selects, and a revoke for each that stopped matching. Each run holds the
 * aggregate's lock, so a trigger and the sweep never both attach one member. Logs ids and counts.
 */
export class AggregateReconcilerService {
  static create(deps: AggregateReconcilerDependencies): AggregateReconcilerService {
    return new AggregateReconcilerService(deps);
  }

  private constructor(private readonly deps: AggregateReconcilerDependencies) {}

  /** Brings one aggregate's reads in line with its rule; an archived one reads nothing. */
  reconcile({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<AggregateReconcileResult> {
    return this.deps.lock.withAggregateLock({
      aggregateProjectId,
      reconcile: () => this.reconcileHoldingLock({ aggregateProjectId }),
    });
  }

  /** The organisation's live aggregates, plus the project itself when it is an archived aggregate. */
  async aggregatesToReconcile({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    /** The project a fact named; absent for a member fact, which names no project. */
    projectId?: string;
  }): Promise<string[]> {
    const [live, own] = await Promise.all([
      this.deps.projects.findLiveAggregateIds({ organizationId }),
      projectId ? this.deps.projects.findAggregate({ aggregateProjectId: projectId }) : [],
    ]);
    const retiring = own.filter((aggregate) => aggregate.archived).map((aggregate) => aggregate.id);
    return [...live, ...retiring];
  }

  /** Every live aggregate of every organisation, for the daily sweep. */
  liveAggregates(): Promise<LiveAggregate[]> {
    return this.deps.projects.findAllLiveAggregates();
  }

  private async reconcileHoldingLock({
    aggregateProjectId,
  }: {
    aggregateProjectId: string;
  }): Promise<AggregateReconcileResult> {
    const [aggregate] = await this.deps.projects.findAggregate({ aggregateProjectId });
    if (!aggregate) return NOTHING;
    if (aggregate.archived) return this.retire(aggregate);
    const { organizationId, rule } = aggregate;
    if (!rule) {
      // An unreadable rule is not an empty one: revoking on it would empty the aggregate.
      logger.error(
        { organizationId, aggregateProjectId },
        "aggregate project has a stored rule that does not parse; reconciling nothing",
      );
      return NOTHING;
    }

    const [desired, live] = await Promise.all([
      this.membersOf({ rule, organizationId }),
      this.deps.grants.findLiveSharedProjectGrants({
        organizationId,
        readerProjectId: aggregateProjectId,
      }),
    ]);
    const decision = decideAggregateMembership({
      aggregateProjectId,
      desired,
      held: live.map((row) => row.memberProjectId),
    });

    // Revocations first: a member that stopped matching stops being read even when an attach fails.
    if (decision.revoke.length > 0) {
      await this.deps.grants.revokeSharedProjectGrants({
        organizationId,
        readerProjectId: aggregateProjectId,
        memberProjectIds: decision.revoke,
        actor: ACTOR,
        reason: AGGREGATE_RULE_NO_LONGER_MATCHES,
      });
    }
    const { attached, alreadyHeld, failed } = await this.attachMissing({
      organizationId,
      aggregateProjectId,
      missing: decision.attach,
    });
    const result: AggregateReconcileResult = {
      attached,
      revoked: decision.revoke,
      unchanged: [...decision.unchanged, ...alreadyHeld].toSorted(),
      failed,
    };
    logger.info(
      {
        organizationId,
        aggregateProjectId,
        ruleKind: rule.kind,
        attached: result.attached.length,
        revoked: result.revoked.length,
        unchanged: result.unchanged.length,
        failed: result.failed.length,
      },
      "reconciled aggregate project members",
    );
    return result;
  }

  /** The member project ids the rule selects today; a department is its members' current one. */
  private async membersOf({
    rule,
    organizationId,
  }: {
    rule: AggregateRule;
    organizationId: string;
  }): Promise<string[]> {
    switch (rule.kind) {
      case "all-personal":
        return this.activeOwnersPersonalProjects({ organizationId });
      case "personal-by-department":
        return this.activeOwnersPersonalProjects({
          organizationId,
          departmentId: rule.departmentId,
        });
      case "explicit":
        return this.deps.projects.findReadableProjectIds({
          organizationId,
          projectIds: [...new Set(rule.projectIds)],
        });
    }
  }

  /** A disabled owner's personal project is no member (ADR-177 v4.4, M8487-DISABLED-READ). */
  private async activeOwnersPersonalProjects({
    organizationId,
    departmentId,
  }: {
    organizationId: string;
    departmentId?: string;
  }): Promise<string[]> {
    const members = await this.deps.organizations.findMembersWithDepartments({ organizationId });
    const ownerUserIds = members
      .filter((member) => member.disabledAt === null)
      .filter((member) => departmentId === undefined || member.departmentId === departmentId)
      .map((member) => member.userId);
    if (ownerUserIds.length === 0) return [];
    return this.deps.projects.findPersonalProjectIds({ organizationId, ownerUserIds });
  }

  /** Attaches each missing member, then waits once for the batch; one refusal does not stop the rest. */
  private async attachMissing({
    organizationId,
    aggregateProjectId,
    missing,
  }: {
    organizationId: string;
    aggregateProjectId: string;
    missing: readonly string[];
  }): Promise<{ attached: string[]; alreadyHeld: string[]; failed: string[] }> {
    const attached: { memberProjectId: string; grantId: string }[] = [];
    const alreadyHeld: string[] = [];
    const failed: string[] = [];
    const from = this.deps.now().toString();
    for (const memberProjectId of missing) {
      try {
        const outcome = await this.deps.grants.attachSharedProjectGrant({
          organizationId,
          readerProjectId: aggregateProjectId,
          memberProjectId,
          condition: { type: "trace", from },
          actor: ACTOR,
          awaitProjection: false,
        });
        // Not attached: a direct ledger write took the pair since the live read; its row stands.
        if (outcome.wasAttached) attached.push({ memberProjectId, grantId: outcome.grantId });
        else alreadyHeld.push(memberProjectId);
      } catch (error) {
        failed.push(memberProjectId);
        logger.error(
          { organizationId, aggregateProjectId, memberProjectId, error },
          "a member of an aggregate project could not be attached; the next reconcile tries it again",
        );
      }
    }
    await this.deps.grants.awaitSharedProjectGrants({
      organizationId,
      grantIds: attached.map((row) => row.grantId),
    });
    return { attached: attached.map((row) => row.memberProjectId), alreadyHeld, failed };
  }

  /** An archived aggregate reads nothing: every shared read it holds is revoked, marked not deleted. */
  private async retire({
    id,
    organizationId,
  }: StoredAggregateProject): Promise<AggregateReconcileResult> {
    const revoked = await this.deps.grants.revokeSharedProjectGrants({
      organizationId,
      readerProjectId: id,
      actor: ACTOR,
      reason: AGGREGATE_ARCHIVED,
    });
    logger.info(
      { organizationId, aggregateProjectId: id, revoked: revoked.length },
      "retired an archived aggregate project's shared reads",
    );
    return NOTHING;
  }
}
