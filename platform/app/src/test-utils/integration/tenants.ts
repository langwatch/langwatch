/**
 * Tenant identity for integration tests.
 *
 * `TenantId` is a plain `string` in `@langwatch/event-sourcing`
 * (`projections/store.types.ts`), so the legacy branded-constructor helpers
 * this replaces — `createTestTenantId` and `getTenantIdString` — had nothing
 * left to convert between and did not move.
 */

/** A tenant id no concurrent test shares, so parallel suites cannot collide. */
export function generateTestTenantId(): string {
  return `test-tenant-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}
