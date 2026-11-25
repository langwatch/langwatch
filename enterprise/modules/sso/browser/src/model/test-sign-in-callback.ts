// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Which `?error=` on this page belongs to a test sign-in, and to WHICH
 * connection's. `error`/`error_description` is the shape every OAuth bounce
 * uses, and the page offering the test is an ordinary application route other
 * flows land on — so without a marker of our own, any error parameter was
 * reported as this connection's provider bouncing the test back, quoting
 * somebody else's code at an administrator.
 */

/** The query key that says an error on this page is a test sign-in's. */
export const TEST_SIGN_IN_MARKER = "ssoTest";

export type SsoQueryReading = Readonly<Record<string, string | undefined>>;

/** What the provider bounced back with, when the bounce was this test's. */
export interface TestSignInVerdict {
  /** The code as it arrived, before the host normalises it. */
  code: string;
  /** `error_description` as the provider sent it, where there is one. */
  description: string | null;
  /** On `sso_issuer_mismatch`: the issuer the connection holds and the one the token carried. */
  expectedIssuer: string | null;
  receivedIssuer: string | null;
}

/** An issuer as the callback reported it, kept only when it is a plain https
 *  address: the query string is caller-controlled. */
function issuersIn(value: string | undefined): string[] {
  if (!value || value.length > 2048) return [];
  try {
    return new URL(value).protocol === "https:" ? [value] : [];
  } catch {
    return [];
  }
}

/**
 * The query the provider should return to this page carrying: this test's
 * marker, and no verdict from an earlier attempt — whatever is on the address
 * now is about to be replaced by this attempt's answer.
 */
export function testSignInCallbackQuery({
  query,
  connectionId,
}: {
  query: SsoQueryReading;
  connectionId: string;
}): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = { ...query };
  delete next.error;
  delete next.error_description;
  delete next.expected_issuer;
  delete next.received_issuer;
  next[TEST_SIGN_IN_MARKER] = connectionId;

  return next;
}

/** The verdict on the address bar, or null when none of it is this test's. */
export function testSignInCallbackVerdict({
  query,
  connectionId,
}: {
  query: SsoQueryReading;
  connectionId: string;
}): TestSignInVerdict | null {
  const code = query.error;
  if (!code) return null;
  if (query[TEST_SIGN_IN_MARKER] !== connectionId) return null;

  return {
    code,
    description: query.error_description ?? null,
    expectedIssuer: issuersIn(query.expected_issuer)[0] ?? null,
    receivedIssuer: issuersIn(query.received_issuer)[0] ?? null,
  };
}
