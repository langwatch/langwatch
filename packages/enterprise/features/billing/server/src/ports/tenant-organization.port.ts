// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The tenant-to-organization lookup the billable-events meter runs on.
 *
 * Separate from `BillingOrganizationPort`, which reads an organization the
 * caller has already named. This one answers the question that comes first:
 * an event carries a tenant (a project), and billing is counted per
 * organization, so every billable event has to be attributed before it can be
 * stored or reported. A project with no team, or a team with no organization,
 * is an orphan rather than an error — it is skipped, never billed to a
 * neighbour.
 */
export abstract class BillingTenantOrganizationPort {
  /** Null means the tenant has no organization; never a fallback to another. */
  abstract tryFindOrganizationForTenant(tenantId: string): Promise<string | null>;
}
