/**
 * Where one organization's data lives.
 *
 * The answer used to decide whether an organization ran at all, which on the
 * automatic axis would have stranded exactly the private-dataplane customers
 * on the legacy path forever.
 *
 * It decides nothing now. These migrations are rooted in the organization and
 * the routing places an organization-rooted append on that organization's own
 * instance, so the dataplane is what a pass REPORTS, not what it filters by.
 */
export type OrganizationDataplane =
  | Readonly<{ kind: "shared" }>
  | Readonly<{ kind: "private"; endpoint: string }>;

export abstract class OrganizationDataplanePort {
  /**
   * Synchronous: the routing table is an environment fact read once at boot,
   * so a pass that asks per organization must not pay a round trip for it.
   */
  abstract dataplaneFor(organizationId: string): OrganizationDataplane;
}
