/**
 * Who this deployment counts as a LangWatch platform operator, by address. The answer is
 * `ADMIN_EMAILS`, and the ops feature owns both the variable and the comparison.
 */
export abstract class PlatformOperatorPort {
  /** Whether this address is on the deployment's operator list. */
  abstract isPlatformOperatorEmail(input: { email: string | null }): boolean;
}
