import { PASSWORD_AMR, PHISHING_RESISTANT_AMR } from "./mfa-condition.ts";

/**
 * Which of somebody's ways in minted a session, as a value something can
 * decide on. `oidc` and `saml` give ONE answer: a federated callback records
 * the protocol, never which mounted provider it was.
 */
export type SignedInWith = "password" | "passkey" | "federated" | "unknown";

/**
 * `unknown` is an ordinary answer rather than a missing one: every session
 * minted before the column recorded no factors at all, and nothing may read
 * that as a password.
 */
export function signedInWithFor({
  amr,
}: {
  amr: readonly string[] | null | undefined;
}): SignedInWith {
  if (!amr || amr.length === 0) return "unknown";
  if (amr.includes(PHISHING_RESISTANT_AMR)) return "passkey";
  if (amr.includes("oidc") || amr.includes("saml")) return "federated";
  if (amr.includes(PASSWORD_AMR)) return "password";
  return "unknown";
}

/**
 * The words are a rendering of the answer above rather than a second reading
 * of `amr`, so a screen that ACTS on which method minted a session and a
 * screen that PRINTS it cannot disagree about what it proved.
 */
const SIGN_IN_METHOD_LABELS: Record<SignedInWith, string> = {
  passkey: "Passkey",
  federated: "Identity provider",
  password: "Email and password",
  unknown: "Signed in",
};

export function signInMethodLabelFor({
  amr,
}: {
  amr: readonly string[] | null | undefined;
}): string {
  return SIGN_IN_METHOD_LABELS[signedInWithFor({ amr })];
}
