export type AuthzCutoverReadFailure = {
  organizationId: string;
  error: unknown;
  ttlMs: number;
};

/** Injectable reporting capability; no module import mutates a reporter. */
export abstract class AuthzCutoverFailureReporter {
  abstract report(failure: AuthzCutoverReadFailure): void;
}
