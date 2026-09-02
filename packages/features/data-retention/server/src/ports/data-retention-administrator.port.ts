/**
 * Whether the caller is a PLATFORM administrator, which is not a customer tier.
 *
 * Disabling retention entirely — keep data indefinitely, exempt from TTL
 * deletion — is a platform capability rather than a plan feature: an
 * organization admin configures a finite window, and only the deployment's own
 * operators may opt data out of deletion. The allow-list behind this answer is
 * the deployment's, which is why it arrives as a port rather than as a role.
 */
export abstract class DataRetentionAdministratorPort {
  abstract isPlatformAdministrator(input: {
    userId: string | null;
    email: string | null;
  }): boolean;
}
