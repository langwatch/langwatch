import { EventUtils } from "~/server/event-sourcing/utils/event.utils";

/**
 * Resolves and validates a single tenantId for a batch of entries that
 * each carry their own tenantId. ClickHouse client routing is per-tenant,
 * so each batch must contain entries from exactly one tenant.
 *
 * Throws when the input is empty or when tenants are mixed.
 */
export function validateBatchTenants<T extends { tenantId: string }>(
  entries: readonly T[],
  context: string,
): string {
  if (entries.length === 0) {
    throw new Error(
      `${context}: cannot validate tenants on an empty batch — caller must short-circuit first`,
    );
  }

  const tenantId = entries[0]!.tenantId;
  EventUtils.validateTenantId({ tenantId }, context);

  const mixedTenant = entries.find((e) => e.tenantId !== tenantId);
  if (mixedTenant) {
    throw new Error(
      `Mixed tenants in ${context}: expected ${tenantId}, got ${mixedTenant.tenantId}. ` +
        `Each batch must contain a single tenant to ensure correct DB routing.`,
    );
  }

  return tenantId;
}
