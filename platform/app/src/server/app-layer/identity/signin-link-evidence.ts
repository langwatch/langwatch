import {
  identifierProviderFor,
  type LinkProposalReason,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import { linkRefusalFor } from "@langwatch/identity-server";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:identity:signin-link-evidence");

/**
 * The claims a link is judged on. Both optional on purpose: an identity
 * provider that asserts neither has told us nothing, and silence is not
 * evidence of anything.
 */
const assertedClaimsSchema = z.object({
  email: z.string().min(1).optional(),
  email_verified: z.boolean().optional(),
});

/**
 * The account a provider wants to attach to, as the rule needs it: whether
 * its own address was ever confirmed, and how many sign-in methods it already
 * holds.
 */
export interface SignInLinkCandidate {
  holdsVerifiedEmail: boolean;
  attachedAccounts: number;
}

/** The reads this guard makes. ADR-129 keeps the queries one tier down. */
export interface SignInLinkEvidenceRepository {
  findCandidate(input: { userId: string }): Promise<SignInLinkCandidate | null>;
}

export interface SignInLinkEvidenceDeps {
  repository: SignInLinkEvidenceRepository;
  /** The identity write surface, resolved per call like every ledger user. */
  proposeLink: (input: {
    tenantId: string;
    userId: string;
    commandId: string;
    proposalId: string;
    connectionId: string | null;
    provider: ReturnType<typeof identifierProviderFor>;
    providerAccountId: string;
    value: string;
    reason: LinkProposalReason;
    occurredAtMs: number;
    actor: { type: "system"; id: null };
  }) => Promise<unknown>;
  now: () => number;
  newCommandId: () => string;
  newProposalId: () => string;
}

/**
 * ADR-117 §3's two-sided evidence, applied where better-auth will accept it.
 *
 * WHY IT LIVES HERE AND NOT IN THE SERVICE THAT OWNS THE RULE.
 * `SignInCallbackLinkingService.complete` was written to own the whole
 * callback: resolve the user, then link, propose or provision. better-auth
 * owns that resolution on every deployment we run, and the only seam it
 * offers before an `Account` row exists is `account.create.before` — which
 * arrives with the link ALREADY chosen. So the service's rule runs here,
 * through the one exported `linkRefusalFor` both callers share, and the
 * service keeps its own entry point for a caller that owns a callback.
 *
 * WHAT IT JUDGES, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * Only a link onto a person who ALREADY holds a sign-in method. Somebody with
 * no `Account` rows is either brand new or an orphan row, and better-auth
 * already refuses to link an orphan whose own `emailVerified` is false —
 * proven against a real callback in
 * `generic-oauth-id-token-verification.integration.test.ts`, and specified in
 * `specs/auth/sso-orphan-user-linking.feature`. Judging that case a second
 * time here would only add a way to lock a new signup out.
 *
 * Only when the identity provider actually asserted something. No ID token,
 * no `email` claim or no `email_verified` claim means no evidence, and the
 * link proceeds exactly as it did before this guard existed.
 *
 * NOT the domain half of the rule. `linkRefusalFor` also refuses a candidate
 * holding identifiers on domains the connection cannot vouch for — and a
 * callback here carries no connection at all (D04 has not given the legacy
 * env provider one). "Domains this connection does not own" has no answer
 * without a connection, so the candidate is passed with none and the rule
 * reduces to the evidence this seam can actually weigh.
 */
export class SignInLinkEvidence {
  constructor(private readonly deps: SignInLinkEvidenceDeps) {}

  /**
   * Answers whether the link may stand, and records a proposal when it may
   * not — so a refusal leaves an administrator something to act on rather
   * than only a closed door.
   */
  async refusalForLink({
    userId,
    providerId,
    providerAccountId,
    idToken,
  }: {
    userId: string;
    providerId: string;
    providerAccountId: string;
    idToken: string | undefined;
  }): Promise<LinkProposalReason | null> {
    const asserted = assertedAddress(idToken);
    if (!asserted) return null;

    const candidate = await this.deps.repository.findCandidate({ userId });
    // Nobody to link onto, or nothing already linked: see the header.
    if (!candidate || candidate.attachedAccounts === 0) return null;

    const reason = linkRefusalFor({
      assertion: {
        connectionId: null,
        provider: identifierProviderFor(providerId),
        subject: providerAccountId,
        email: asserted.email,
        emailVerified: asserted.emailVerified,
        allowsJit: false,
      },
      candidates: [
        {
          userId,
          holdsVerifiedEmail: candidate.holdsVerifiedEmail,
          identifierDomains: [],
        },
      ],
    });
    if (!reason) return null;

    await this.recordProposal({
      userId,
      providerId,
      providerAccountId,
      value: asserted.email,
      reason,
    });
    return reason;
  }

  /**
   * The proposal, best-effort. A failure to WRITE one must not turn into a
   * link being allowed: the refusal is the security answer and it stands on
   * its own, while the proposal is what makes the refusal recoverable.
   */
  private async recordProposal({
    userId,
    providerId,
    providerAccountId,
    value,
    reason,
  }: {
    userId: string;
    providerId: string;
    providerAccountId: string;
    value: string;
    reason: LinkProposalReason;
  }): Promise<void> {
    try {
      await this.deps.proposeLink({
        tenantId: userId,
        userId,
        commandId: this.deps.newCommandId(),
        proposalId: this.deps.newProposalId(),
        connectionId: null,
        provider: identifierProviderFor(providerId),
        providerAccountId,
        value,
        reason,
        occurredAtMs: this.deps.now(),
        actor: { type: "system", id: null },
      });
    } catch (error) {
      logger.error(
        { userId, providerId, reason, error },
        "refused a sign-in link but could not record the proposal an administrator would resolve",
      );
    }
  }
}

/**
 * What the identity provider asserted, or null when it asserted nothing this
 * rule can weigh.
 *
 * Read from the ID TOKEN rather than from the profile better-auth mapped,
 * because the token is the part that was signature-checked. An unverified or
 * unparsable token yields null and the link is left alone — this guard is not
 * where token verification happens, and pretending otherwise would let a
 * malformed token read as a refusal.
 */
function assertedAddress(
  idToken: string | undefined,
): { email: string; emailVerified: boolean } | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = assertedClaimsSchema.safeParse(claims);
  if (!parsed.success) return null;

  const { email, email_verified: emailVerified } = parsed.data;
  // Both halves, or nothing. An address with no verification claim beside it
  // is the silence this guard refuses to read as either answer.
  if (!email || emailVerified === undefined) return null;
  return { email: normalizeIdentifierValue(email), emailVerified };
}
