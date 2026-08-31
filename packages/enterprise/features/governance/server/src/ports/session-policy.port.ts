/**
 * The one policy an organization admin turns from the governance settings
 * page: `maxSessionDurationDays`, a hard cap on CLI/device session lifetime
 * before re-login. `0` means unbounded, and the `/exchange` refresh path treats
 * any value above the refresh-token's natural life as a no-op ceiling.
 *
 * Kept a repository (not a service) because the whole surface is one column
 * on `Organization` — the port answers a load and a store, and the service
 * layer is where the range check and any future policy live.
 */
export type OrganizationSessionPolicy = Readonly<{
  maxSessionDurationDays: number;
}>;

export abstract class OrganizationSessionPolicyPort {
  abstract find(organizationId: string): Promise<OrganizationSessionPolicy>;
  abstract setMaxDurationDays(
    organizationId: string,
    maxSessionDurationDays: number,
  ): Promise<void>;
}
