/**
 * Licensing's copy of sso's sign-in provider fact (ADR-179): which provider the deployment
 * configured, whether it mounted, and the id of the event that said so. One row.
 */
export interface SignInProviderMount {
  /** The configured provider's name; `null` when the deployment signs in by email. */
  readonly provider: string | null;
  readonly mounted: boolean;
  /** The last sso event applied to the row: its idempotency guard and its version. */
  readonly lastAppliedEventId: string;
}

export interface SignInProviderMountRepository {
  /** The row, or none before sso's first fact is applied. */
  find(): Promise<readonly SignInProviderMount[]>;
  /** Replaces the row. */
  save(mount: SignInProviderMount): Promise<void>;
}
