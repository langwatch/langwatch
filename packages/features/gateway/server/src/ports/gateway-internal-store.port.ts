import type {
  GatewayBudget,
  GatewayBudgetBucketBoundary,
} from "@langwatch/prisma-client/generated";

import type { VirtualKeyWithScopes } from "./gateway-virtual-key.port";

/**
 * The row reads the Go data plane's control-plane calls make that no service
 * on this package already owns.
 *
 * Every one of them was an inline `prisma.<model>.<verb>` inside a route
 * handler in the retired application. They are a port here for the reason the
 * layering rule gives — a transport calls services, never a database — and
 * they are ONE port rather than four because they are one caller: the internal
 * family, whose six methods are exactly what its five routes read.
 *
 * The shapes are the reads as they were, not narrowed: `findVirtualKeyForConfig`
 * returns the record the config materialiser is typed against, including the
 * routing policy that carries the model aliases, because a key materialised
 * without it emits an empty alias map and the gateway silently stops resolving
 * aliases and enforcing model deny rules.
 */
export abstract class GatewayInternalStorePort {
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
   *
   * `null` where the bucket has never been reset, which means the template's
   * own period boundary is the only one bounding the sum.
   */
  abstract findBucketBoundary(input: {
    budgetId: string;
    bucketScopeId: string;
  }): Promise<Pick<GatewayBudgetBucketBoundary, "periodStartedAt"> | null>;

  /**
   * Every project in an organization, which is the tenant list a ClickHouse
   * spend read is scoped by. An organization with no projects has no spend.
   */
  abstract listProjectIdsForOrganization(organizationId: string): Promise<string[]>;

  /**
   * The key rows a batch of spend admissions is attributed against.
   *
   * One read for a whole batch of up to 500 records: the appended event
   * carries the result from then on, so nothing downstream re-reads identity
   * per request.
   */
  abstract findVirtualKeysForAttribution(virtualKeyIds: readonly string[]): Promise<
    Array<{
      id: string;
      organizationId: string;
      principalUserId: string | null;
      lastUsedAt: Date | null;
    }>
  >;

  /** The team each named project belongs to, for the same batch join. */
  abstract findProjectTeams(
    projectIds: readonly string[],
  ): Promise<Array<{ id: string; teamId: string }>>;

  /**
   * Advance `lastUsedAt` on the keys a drain batch admitted.
   *
   * Best effort by contract: the column is administrative oversight rather
   * than enforcement, and failing a batch of billing records over it would
   * cost the drainer a retry of records that already appended.
   */
  abstract touchVirtualKeysLastUsed(input: {
    virtualKeyIds: readonly string[];
    now: Date;
  }): Promise<void>;
}
