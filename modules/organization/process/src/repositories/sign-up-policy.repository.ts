/**
 * The installation-wide reads behind the sign-up policy. Cross-tenant by
 * design: whether an address was invited anywhere is the question.
 */
export abstract class SignUpPolicyRepository {
  /**
   * The code of a PENDING, unexpired invitation for this address, in any
   * organization. At most one comes back; the empty array means none waits.
   */
  abstract findPendingInviteCodes(input: { email: string }): Promise<string[]>;
  /** Whether the installation holds at least one organization. */
  abstract hasAnyOrganization(): Promise<boolean>;
}
