import type { MigrationTenantStatus } from "@langwatch/authz-contract";

export type AuthzCutoverRow = Readonly<{
  status: MigrationTenantStatus;
  occurredAt: Date | null;
}>;

/**
 * The row that says whether an organization's authorization has been cut over
 * to the engine, and when it finished. Reads raise: the caching gate above
 * decides what a failed read means for the caller that asked.
 */
export abstract class AuthzCutoverRepository {
  abstract findCutover(input: { organizationId: string }): Promise<AuthzCutoverRow | null>;
}
