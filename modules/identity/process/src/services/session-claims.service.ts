import {
  deriveSessionAmr,
  type IdentifierFact,
  identifierProviderFor,
  isLiveIdentifierState,
  NO_SESSION_CLAIMS,
  normalizeIdentifierValue,
  type SessionCallbackEvidence,
  type SessionClaims,
  type SessionClaimsMintInput,
  signInProviderForPath,
} from "@langwatch/identity-contract";

import type { IdentityHeadsReader } from "../repositories/identity-heads.repository.ts";
import type { IdentifierIdentity } from "./crypto-identifier-identity.service.ts";

/**
 * What a session records when minted (D06): which of the person's ways in minted it and
 * what that sign-in proved; main's SessionClaimsService.
 * specs/identity/saml-existing-user-linking.feature
 */
export class SessionClaimsService {
  static create(deps: {
    heads: IdentityHeadsReader;
    identifiers: IdentifierIdentity;
  }): SessionClaimsService {
    return new SessionClaimsService(deps);
  }

  private constructor(
    private readonly deps: { heads: IdentityHeadsReader; identifiers: IdentifierIdentity },
  ) {}

  /** An unrecognized path records nothing, the value every pre-D06 session carries. */
  async claimsForMint({ userId, path, callback }: SessionClaimsMintInput): Promise<SessionClaims> {
    const reading = signInProviderForPath({ path });
    if (!reading.recognized) return NO_SESSION_CLAIMS;
    const providerId = reading.provider;
    const isLocal = providerId === "credential" || providerId === "passkey";
    // A callback path alone proves nothing: without this request's evidence even the
    // protocol label is omitted, so a stale Account cannot pass for a provider-backed session.
    if (!isLocal && !callback) return NO_SESSION_CLAIMS;
    const evidence = isLocal ? undefined : callback;

    const identifierId = await this.identifierIdFor({ userId, providerId, evidence });
    return {
      identifierId,
      amr:
        isLocal || evidence?.verifiedTokenClaims
          ? deriveSessionAmr({ path, providerAssertedAmr: evidence?.assertedFactors ?? [] })
          : [],
    };
  }

  /**
   * The live identifier only, newest first; a detached one names a method the person no
   * longer holds. Before projection, the id the callback's exact native account derives,
   * unless a row already claims that id or account: never revive or borrow evidence.
   */
  private async identifierIdFor({
    userId,
    providerId,
    evidence,
  }: {
    userId: string;
    providerId: string;
    evidence: SessionCallbackEvidence | undefined;
  }): Promise<string | null> {
    const heads = Object.values((await this.deps.heads.findHeads({ userId })).identifiers);
    const live = heads
      .filter((head) => isAttributable({ head, providerId, evidence }))
      .toSorted((left, right) => right.attachedAtMs - left.attachedAtMs)[0];
    if (live) return live.identifierId;

    const account = evidence?.account;
    if (!evidence || !account) return null;
    const derived = this.deps.identifiers.deriveIdentifierId({
      userId,
      provider: identifierProviderFor(providerId),
      providerAccountId: evidence.providerAccountId,
      normalizedValue: normalizeIdentifierValue(account.email),
      occurredAtMs: account.createdAtMs,
    });
    const claimed = heads.some(
      (head) => head.identifierId === derived || head.accountId === account.accountId,
    );
    return claimed ? null : derived;
  }
}

function isAttributable({
  head,
  providerId,
  evidence,
}: {
  head: IdentifierFact;
  providerId: string;
  evidence: SessionCallbackEvidence | undefined;
}): boolean {
  if (head.providerId !== providerId) return false;
  if (evidence && head.providerAccountId !== evidence.providerAccountId) return false;
  return head.detachedAtMs === null && isLiveIdentifierState(head.state);
}
