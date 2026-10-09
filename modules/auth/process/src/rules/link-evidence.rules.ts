import { assertedEmailVerification, type LinkProposalReason } from "@langwatch/identity-contract";
import { z } from "zod";

/** The claims the evidence rule weighs; a provider may assert no address at all. */
const assertedClaimsSchema = z.looseObject({
  email: z.string().min(1).optional(),
  iss: z.string().optional(),
});

/** What an ID token asserted about its address: both halves, or nothing to weigh. */
export type AssertedAddress =
  | { asserted: false }
  | { asserted: true; email: string; emailVerified: boolean };

/** Whether an addition to an account may stand without an administrator (ADR-117 §3). */
export type LinkVerdict = { refused: false } | { refused: true; reason: LinkProposalReason };

const UNASSERTED: AssertedAddress = { asserted: false };
const ALLOWED: LinkVerdict = { refused: false };

/** An address with no verification claim beside it, or an unreadable token, asserts nothing. */
export function assertedAddressOf({ idToken }: { idToken: unknown }): AssertedAddress {
  if (typeof idToken !== "string") return UNASSERTED;
  const payload = idToken.split(".")[1];
  if (!payload) return UNASSERTED;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return UNASSERTED;
  }
  const parsed = assertedClaimsSchema.safeParse(claims);
  if (!parsed.success || !parsed.data.email) return UNASSERTED;
  const verification = assertedEmailVerification({
    claimSources: [parsed.data],
    issuer: parsed.data.iss,
  });
  if (verification === "unasserted") return UNASSERTED;
  return { asserted: true, email: parsed.data.email, emailVerified: verification === "verified" };
}

/**
 * A method added to an account that already signs in needs evidence on both sides: the provider
 * verified the address and the account's own address was confirmed. A provider that asserts
 * nothing, or a person with no sign-in method yet, is not judged here.
 */
export function linkVerdictFor({
  address,
  holdsVerifiedEmail,
  attachedAccounts,
}: {
  address: AssertedAddress;
  holdsVerifiedEmail: boolean;
  attachedAccounts: number;
}): LinkVerdict {
  if (!address.asserted || attachedAccounts === 0) return ALLOWED;
  if (address.emailVerified && holdsVerifiedEmail) return ALLOWED;
  return { refused: true, reason: "unverified_orphan" };
}
