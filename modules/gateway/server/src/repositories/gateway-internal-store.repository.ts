import type { GatewayBudget, GatewayBudgetBucketBoundary,VirtualKeyWithScopes } from "@langwatch/gateway-contract";

import type { Instant } from "@langwatch/time";

/**
 * One repository, not four, because these are one caller (the internal family).
 * Shapes are the original reads, not narrowed — `findVirtualKeyForConfig` keeps
 * the routing policy's aliases, or the gateway silently stops enforcing them.
 */
export abstract class GatewayInternalStoreRepository {
  /**
   * One virtual key with everything the warm-cache config is built from.
   *
   * `null` when no key has that id, which the route answers 404 for.
   */
  abstract findVirtualKeyForConfig(virtualKeyId: string): Promise<VirtualKeyWithScopes | null>;

  /** One budget by id, whatever its state; the route decides what it may serve. */
  abstract findBudget(budgetId: string): Promise<GatewayBudget | null>;

  /**
   * The per-user reset boundary for one bucket of an attributed-user budget.
   * `null` means never reset — the template's own period boundary is the
   * only one bounding the sum.
   */
  abstract findBucketBoundary(input: {
    budgetId: string;
    bucketScopeId: string;
  }): Promise<Pick<GatewayBudgetBucketBoundary, "periodStartedAt"> | null>;

  /**
   * Every project in an organization, which is the tenant list a ClickHouse
   * spend read is scoped by. An organization with no projects has no spend.
   */
  abstract findProjectIdsForOrganization(organizationId: string): Promise<string[]>;

  /**
   * The key rows a batch of spend admissions is attributed against. One
   * read for up to 500 records: the appended event carries the result from
   * then on, so nothing downstream re-reads identity per request.
   */
  abstract findVirtualKeysForAttribution(virtualKeyIds: readonly string[]): Promise<
    {
      id: string;
      organizationId: string;
      principalUserId: string | null;
      lastUsedAt: Instant | null;
    }[]
  >;

  /** The team each named project belongs to, for the same batch join. */
  abstract findProjectTeams(
    projectIds: readonly string[],
  ): Promise<{ id: string; teamId: string }[]>;

  /**
   * Advance `lastUsedAt` on the keys a drain batch admitted. Best effort:
   * the column is administrative oversight, not enforcement, so failing the
   * batch over it would cost the drainer a retry of records already appended.
   */
  abstract touchVirtualKeysLastUsed(input: {
    virtualKeyIds: readonly string[];
    now: Instant;
  }): Promise<void>;
}
