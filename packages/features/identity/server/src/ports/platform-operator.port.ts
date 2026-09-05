/**
 * Who this deployment counts as a LangWatch platform operator, by address.
 *
 * The answer is `ADMIN_EMAILS`, and the ops feature owns both the variable and
 * the comparison. Identity asks the question through this port rather than
 * reading that list itself: two packages parsing one variable is how two
 * processes end up with different operator lists, and the composition root
 * already holds the one answer.
 */
export abstract class PlatformOperatorPort {
  /** Whether this address is on the deployment's operator list. */
  abstract isPlatformOperatorEmail(input: { email: string | null }): boolean;
}
