import { AsyncLocalStorage } from "node:async_hooks";

import { type SessionCallbackEvidence, signInProviderForPath } from "@langwatch/identity-contract";
import { z } from "zod";

/** The provider account a callback accepted, before the account row is read. */
export type AcceptedCallbackAccount = Omit<SessionCallbackEvidence, "account"> &
  Readonly<{ providerId: string }>;

/** The verified ID token's claims a callback may earn credit from. */
const verifiedCallbackClaimsSchema = z.object({
  sub: z.string().min(1),
  amr: z.array(z.string()).optional(),
});

/** The providers whose ID tokens are verified before a callback writes an account. */
const VERIFIED_AMR_PROVIDERS = new Set(["auth0", "okta"]);

type PendingToken = Readonly<{
  providerId: string;
  providerAccountId: string;
  assertedFactors: readonly string[];
}>;

/** The issuer one single sign-on subject was verified under, kept for its account row. */
type AssertedIssuer = Readonly<{ providerId: string; providerAccountId: string; issuer: string }>;

/** Whether this request's callback path is the provider's own; anything else earns nothing. */
function isCallbackFor({ providerId, path }: { providerId: string; path: string }): boolean {
  const reading = signInProviderForPath({ path });
  return reading.recognized && reading.provider === providerId;
}

/**
 * The exact provider account this request's callback accepted, kept per request so the
 * session it mints is attributed to it and no other (D06); Better Auth hands the seam and
 * the hook no shared argument. specs/identity/saml-existing-user-linking.feature
 */
export class SessionCallbackEvidenceChannel {
  static create(): SessionCallbackEvidenceChannel {
    return new SessionCallbackEvidenceChannel();
  }

  private readonly scope = new AsyncLocalStorage<{
    accepted: AcceptedCallbackAccount[];
    pendingToken: PendingToken | null;
    assertedIssuer: AssertedIssuer | null;
  }>();

  private constructor() {}

  /** Opens the per-request slot; outside one, nothing is recorded or found. */
  runWithScope<T>(run: () => Promise<T>): Promise<T> {
    return this.scope.run({ accepted: [], pendingToken: null, assertedIssuer: null }, run);
  }

  /** The account the SSO plugin's resolveUser seam admitted, and the issuer it was verified
   *  under, before it writes an account row or mints a session (ADR-189). Identity refuses an
   *  assertion naming no issuer, so one is always recorded. */
  recordAuthenticatedSsoAccount({
    providerId,
    providerAccountId,
    issuer,
  }: {
    providerId: string;
    providerAccountId: string;
    issuer: string;
  }): void {
    const slot = this.scope.getStore();
    if (!slot || !providerId || !providerAccountId) return;
    slot.accepted = [
      { providerId, providerAccountId, assertedFactors: [], verifiedTokenClaims: false },
    ];
    slot.assertedIssuer = { providerId, providerAccountId, issuer };
  }

  /** The issuer the SSO seam verified this exact subject under: one entry, or none. */
  findAssertedIssuers({
    providerId,
    providerAccountId,
  }: {
    providerId: string;
    providerAccountId: string;
  }): string[] {
    const asserted = this.scope.getStore()?.assertedIssuer;
    if (!asserted) return [];
    const isThisSubject =
      asserted.providerId === providerId && asserted.providerAccountId === providerAccountId;
    return isThisSubject ? [asserted.issuer] : [];
  }

  /**
   * The ID token an Auth0 or Okta callback verified before writing its account (main's
   * VerifiedCallbackProviderAssertions): its `amr` counts only once the accepted account's
   * subject matches. specs/identity/mfa-and-session-shape.feature
   */
  recordVerifiedCallbackToken({
    providerId,
    path,
    verifiedIdToken,
  }: {
    providerId: string;
    path: string | undefined;
    verifiedIdToken: string | undefined;
  }): void {
    const slot = this.scope.getStore();
    if (!slot || !path || !verifiedIdToken || !VERIFIED_AMR_PROVIDERS.has(providerId)) return;
    if (!isCallbackFor({ providerId, path })) return;
    const [claims] = findVerifiedCallbackClaims(verifiedIdToken);
    if (!claims) return;

    slot.pendingToken = {
      providerId,
      providerAccountId: claims.sub,
      assertedFactors: claims.amr ?? [],
    };
    slot.accepted = slot.accepted.map((accepted) =>
      accepted.providerId === providerId && accepted.providerAccountId === claims.sub
        ? { ...accepted, assertedFactors: claims.amr ?? [], verifiedTokenClaims: true }
        : accepted,
    );
  }

  /** The account a generic OAuth callback accepted; token claims count only for its subject. */
  recordAuthenticatedCallbackAccount({
    providerId,
    providerAccountId,
    path,
  }: {
    providerId: string;
    providerAccountId: string;
    path: string | undefined;
  }): void {
    const slot = this.scope.getStore();
    if (!slot || !path || !providerAccountId) return;
    if (!isCallbackFor({ providerId, path })) return;

    const token = slot.pendingToken;
    const verifiedTokenClaims =
      token?.providerId === providerId && token.providerAccountId === providerAccountId;
    slot.accepted = [
      {
        providerId,
        providerAccountId,
        assertedFactors: verifiedTokenClaims && token ? [...token.assertedFactors] : [],
        verifiedTokenClaims,
      },
    ];
  }

  /** This request's accepted account for the provider: one entry, or none at all. */
  findAcceptedAccounts({ providerId }: { providerId: string }): AcceptedCallbackAccount[] {
    return (this.scope.getStore()?.accepted ?? []).filter(
      (accepted) => accepted.providerId === providerId,
    );
  }
}

/** An ID token payload Better Auth already verified: one entry, or none for anything else. */
function findVerifiedCallbackClaims(
  idToken: string,
): z.infer<typeof verifiedCallbackClaimsSchema>[] {
  const payload = idToken.split(".")[1];
  if (!payload) return [];
  try {
    const parsed = verifiedCallbackClaimsSchema.safeParse(
      JSON.parse(new TextDecoder().decode(base64UrlBytes(payload))),
    );
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

function base64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  );
}
