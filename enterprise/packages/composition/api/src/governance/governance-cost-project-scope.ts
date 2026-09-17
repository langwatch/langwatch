// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Where the metered lane's tenant scope comes from.
 *
 * `gateway_spend.TenantId` is the traffic's own project id, not the hidden
 * governance tenant the rollup is written under, so reading the metered lane
 * means naming every project of the organization. That is the one place the
 * two lanes' tenant scopes differ, and the whole reason the metered lane used
 * to read empty (ADR-128).
 *
 * A port rather than the project repository interface itself, for two reasons.
 * The cost service uses exactly one of that interface's twenty-odd methods, so
 * depending on the whole of it would tie a governance read to every future
 * change in project management. And the interface lives in a module this
 * package must not reach around into: the composition root supplies the
 * implementation, which is `ProjectRepository.findIdsByOrganization` — already
 * unfiltered by `archivedAt` and by kind, which is what this needs, since a
 * project archived last month still has spend inside the window.
 */
export interface GovernanceCostProjectScope {
  /**
   * Every project id of the organization: archived ones and every kind
   * INCLUDED.
   */
  findIdsByOrganization: (organizationId: string) => Promise<string[]>;
}
