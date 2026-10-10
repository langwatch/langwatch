/** An organization's legacy SSO pin as the domain lookup finds it. */
export type LegacySsoOrganization = { id: string; name: string; ssoProvider: string | null };

/**
 * The legacy `Organization.ssoDomain` / `ssoProvider` columns (ADR-117 §5), read-only: they
 * keep deciding sign-in for a domain no projected connection answers for.
 */
export abstract class LegacySsoOrganizationRepository {
  /** `SsoConnectionNotFoundError` when the organization carries no complete legacy pair. */
  abstract getLegacySso(args: {
    organizationId: string;
  }): Promise<{ ssoDomain: string; ssoProvider: string }>;
  /** The organization registered to a domain, by the same columns; null when none is. */
  abstract findByDomain(args: { domain: string }): Promise<LegacySsoOrganization | null>;
}
