import { AsyncLocalStorage } from "node:async_hooks";

import type { SessionCallbackEvidence } from "@langwatch/identity-contract";

/** The provider account a callback accepted, before the account row is read. */
export type AcceptedCallbackAccount = Omit<SessionCallbackEvidence, "account"> &
  Readonly<{ providerId: string }>;

/**
 * The exact provider account this request's callback accepted, kept per request so the
 * session it mints is attributed to it and no other (D06); Better Auth hands the seam and
 * the hook no shared argument. specs/identity/saml-existing-user-linking.feature
 */
export class SessionCallbackEvidenceChannel {
  static create(): SessionCallbackEvidenceChannel {
    return new SessionCallbackEvidenceChannel();
  }

  private readonly scope = new AsyncLocalStorage<{ accepted: AcceptedCallbackAccount[] }>();

  private constructor() {}

  /** Opens the per-request slot; outside one, nothing is recorded or found. */
  runWithScope<T>(run: () => Promise<T>): Promise<T> {
    return this.scope.run({ accepted: [] }, run);
  }

  /** The account the SSO plugin's resolveUser seam admitted, before it mints a session. */
  recordAuthenticatedSsoAccount({
    providerId,
    providerAccountId,
  }: {
    providerId: string;
    providerAccountId: string;
  }): void {
    const slot = this.scope.getStore();
    if (!slot || !providerId || !providerAccountId) return;
    slot.accepted = [
      { providerId, providerAccountId, assertedFactors: [], verifiedTokenClaims: false },
    ];
  }

  /** This request's accepted account for the provider: one entry, or none at all. */
  findAcceptedAccounts({ providerId }: { providerId: string }): AcceptedCallbackAccount[] {
    return (this.scope.getStore()?.accepted ?? []).filter(
      (accepted) => accepted.providerId === providerId,
    );
  }
}
