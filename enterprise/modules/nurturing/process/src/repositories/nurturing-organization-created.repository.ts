// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Nurturing's own copy of when an organization was created (`NurturingOrganizationCreated`),
 * written from organization's `lw.organization.created` (§9), for the per-email usage's day
 * offsets. Its own table, not a column of `NurturingOrganization`: the creation can arrive before
 * the project that teaches nurturing the organization, and must not create that row unseeded.
 */
export interface NurturingOrganizationCreatedRepository {
  /** Idempotent: the earliest creation is kept, so a redelivery changes nothing. */
  recordOrganizationCreated(
    input: Readonly<{ organizationId: string; createdAt: number }>,
  ): Promise<void>;
  /** Epoch ms; null for an organization created before nurturing kept the copy. */
  findOrganizationCreatedAt(
    input: Readonly<{ organizationId: string }>,
  ): Promise<Readonly<{ organizationCreatedAt: number | null }>>;
  /** The organizations created in (`after`, `upTo`], epoch ms. */
  findOrganizationIdsCreatedBetween(
    input: Readonly<{ after: number; upTo: number }>,
  ): Promise<string[]>;
}
