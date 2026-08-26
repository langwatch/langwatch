import {
  identifierDomain,
  type IdentifierProvider,
  type LinkProposalReason,
  normalizeIdentifierValue,
} from "@langwatch/identity";
import type { IdentityCeremonyClock } from "./better-auth/ceremony-types";
import type { IdentityLinkProposalWrites } from "./identity-writes";
import {
  IdentityJitDisabledError,
  IdentityLinkProposedError,
} from "./signin-callback-errors";

/**
 * What happens when an SSO callback comes back (ADR-117 §3), in one place and
 * in one order:
 *
 *   1. the (connection, subject) pair already resolves someone   → sign in
 *   2. the evidence is TWO-SIDED and unambiguous                 → auto-link
 *   3. it matched somebody, but not well enough                  → propose
 *   4. it matched nobody                                         → JIT, or deny
 *
 * "Two-sided" is the load-bearing word. Trusting the IdP's `email_verified`
 * alone would let any connection claim any row on its domain — the hijack
 * `sso-orphan-user-linking.feature` exists to prevent. So the matched user has
 * to hold the address themselves, verified, and hold nothing the organization
 * cannot vouch for. Everything short of that is a proposal a human resolves,
 * which is where a human belongs anyway.
 *
 * The service links by asking the directory to create the provider account —
 * better-auth's own write, which fires the account ceremony that attaches the
 * identifier through the pipeline. It never writes an `Account` row and never
 * attaches an identifier itself.
 */

/** What an IdP handed back. */
export interface CallbackAssertion {
  /** The connection whose callback this is; null until D04 gives the legacy
   *  env provider a connection of its own. */
  connectionId: string | null;
  provider: IdentifierProvider;
  /** The IdP's own subject for this person. */
  subject: string;
  /** The address the IdP asserts, raw; null when it asserts none. */
  email: string | null;
  /** Whether the IdP asserts that address as verified. */
  emailVerified: boolean;
  /**
   * What this connection does with somebody it has never seen: admit them,
   * make them wait for an administrator, or turn them away (ADR-117 §3).
   *
   * Bounded by routing rather than by this field: an address only ever
   * reaches a connection whose domain that connection PROVED, so `admit`
   * means "anybody on a domain you proved", never "anybody at all".
   */
  arrivalPolicy: SsoArrivalPolicy;
}

/** A user the asserted address matched, and the evidence they carry. */
export interface CallbackUserMatch {
  userId: string;
  /** The user holds the asserted address themselves, VERIFIED — or, before
   *  they latch, the legacy `emailVerified` column says so. This is the
   *  second side of the two-sided evidence. */
  holdsVerifiedEmail: boolean;
  /** Domains of every live identifier this user holds. An identifier on a
   *  domain the connection does not own is one the organization cannot vouch
   *  for, and a callback may not claim the row that carries it. */
  identifierDomains: readonly string[];
}

/**
 * The user-level reads and writes a callback needs BEFORE the ADR-116 storage
 * adapter serves them. Its own port precisely so the adapter can absorb it
 * later without this service changing: the router deliberately has no per-user
 * fork, and this is the one flow that genuinely needs one.
 */
export interface SignInCallbackDirectoryPort {
  findUserByProviderSubject(input: {
    connectionId: string | null;
    provider: IdentifierProvider;
    subject: string;
  }): Promise<{ userId: string } | null>;

  findUsersByEmail(input: {
    normalizedEmail: string;
  }): Promise<readonly CallbackUserMatch[]>;

  /**
   * Links the callback's provider account to a user through better-auth's own
   * account creation, which fires the ceremony that attaches the identifier.
   * Never a hand-written `Account` insert.
   */
  linkProviderAccount(input: {
    userId: string;
    connectionId: string | null;
    provider: IdentifierProvider;
    subject: string;
    normalizedEmail: string;
  }): Promise<void>;

  /**
   * Just-in-time provisioning, where the connection allows it.
   *
   * `membership` says what the account arrives as: a member of the
   * connection's organization, or an account with a request to join it
   * standing. The account itself is identical — the difference is one row
   * and who has to act next.
   */
  provisionUser(input: {
    connectionId: string | null;
    provider: IdentifierProvider;
    subject: string;
    normalizedEmail: string;
    membership: "join" | "request";
  }): Promise<{ userId: string }>;
}

/**
 * The before/after audit pair around a link (ADR-117 §3). Two records rather
 * than one because they answer different questions: the first says a link was
 * ATTEMPTED and on what evidence, the second says it landed. A link that fails
 * between them leaves the attempt standing, which is exactly what an operator
 * needs to see.
 *
 * Records carry the domain and never the local part, for the same reason the
 * router's do.
 */
export interface SignInCallbackAudit {
  linkAttempted(record: CallbackAuditRecord): void;
  linkRecorded(record: CallbackAuditRecord): void;
}

export interface CallbackAuditRecord {
  userId: string;
  connectionId: string | null;
  provider: IdentifierProvider;
  subject: string;
  domain: string | null;
}

export type CallbackLinkOutcome =
  | { kind: "signed_in"; userId: string; linked: false }
  | { kind: "linked"; userId: string; linked: true }
  | { kind: "provisioned"; userId: string; linked: true }
  /**
   * They exist and they are waiting. The account is real — they signed in,
   * and refusing to remember that would make them do it again for nothing —
   * but they are not a member until somebody answers. The caller lands them
   * wherever a person with no organization lands, with a request already in.
   */
  | { kind: "awaiting_approval"; userId: string; linked: true };

export interface SignInCallbackLinkingDeps {
  directory: SignInCallbackDirectoryPort;
  proposals: IdentityLinkProposalWrites;
  audit: SignInCallbackAudit;
  clock: IdentityCeremonyClock;
  /** Mints a proposal's own id, so a proposal can be pointed at. */
  newProposalId: () => string;
}

export class SignInCallbackLinkingService {
  private readonly directory: SignInCallbackDirectoryPort;
  private readonly proposals: IdentityLinkProposalWrites;
  private readonly audit: SignInCallbackAudit;
  private readonly clock: IdentityCeremonyClock;
  private readonly newProposalId: () => string;

  constructor(deps: SignInCallbackLinkingDeps) {
    this.directory = deps.directory;
    this.proposals = deps.proposals;
    this.audit = deps.audit;
    this.clock = deps.clock;
    this.newProposalId = deps.newProposalId;
  }

  async complete(
    assertion: CallbackAssertion,
  ): Promise<CallbackLinkOutcome> {
    const known = await this.directory.findUserByProviderSubject({
      connectionId: assertion.connectionId,
      provider: assertion.provider,
      subject: assertion.subject,
    });
    // Nothing is created and no event is emitted: this person has signed in
    // through this connection before, and saying so again states no new fact.
    if (known) return { kind: "signed_in", userId: known.userId, linked: false };

    const normalizedEmail = assertion.email
      ? normalizeIdentifierValue(assertion.email)
      : null;
    if (!normalizedEmail) return this.provision(assertion, null);

    const candidates = await this.directory.findUsersByEmail({
      normalizedEmail,
    });
    if (candidates.length === 0) {
      return this.provision(assertion, normalizedEmail);
    }

    const refusal = this.refusalFor({ assertion, candidates });
    if (refusal) {
      // One proposal per candidate. An ambiguous match has no single subject,
      // and picking one to hang the proposal on would be the guess this whole
      // branch exists to avoid — every row a connection reached for gets the
      // fact that it did.
      for (const candidate of candidates) {
        await this.propose({
          assertion,
          normalizedEmail,
          userId: candidate.userId,
          reason: refusal,
        });
      }
      throw new IdentityLinkProposedError();
    }

    const [target] = candidates;
    if (!target) return this.provision(assertion, normalizedEmail);
    return this.link({ assertion, normalizedEmail, userId: target.userId });
  }

  /**
   * An administrator confirmed a proposal: the link is made the same way an
   * automatic one is. The proposal is what changed, not the mechanism — which
   * is the point of proposing rather than guessing.
   */
  async confirmProposal({
    assertion,
    userId,
  }: {
    assertion: CallbackAssertion;
    userId: string;
  }): Promise<CallbackLinkOutcome> {
    const normalizedEmail = assertion.email
      ? normalizeIdentifierValue(assertion.email)
      : "";
    return this.link({ assertion, normalizedEmail, userId });
  }

  /**
   * Why this match is not unambiguous, or null when it is. Order matters only
   * for the reason code an operator reads; any one of them refuses.
   */
  private refusalFor({
    assertion,
    candidates,
  }: {
    assertion: CallbackAssertion;
    candidates: readonly CallbackUserMatch[];
  }): LinkProposalReason | null {
    if (candidates.length > 1) return "ambiguous_candidates";
    const target = candidates[0];
    if (!target) return "ambiguous_candidates";
    // One side of the evidence is the IdP's assertion, the other is the
    // user's own. An unverified orphan row fails the second and is never
    // auto-linked, which is the anti-hijack invariant, kept.
    if (!assertion.emailVerified || !target.holdsVerifiedEmail) {
      return "unverified_orphan";
    }
    const vouched = assertion.email
      ? identifierDomain(normalizeIdentifierValue(assertion.email))
      : null;
    const unvouched = target.identifierDomains.filter(
      (domain) => domain !== vouched,
    );
    return unvouched.length > 0 ? "unvouched_identifiers" : null;
  }

  private async link({
    assertion,
    normalizedEmail,
    userId,
  }: {
    assertion: CallbackAssertion;
    normalizedEmail: string;
    userId: string;
  }): Promise<CallbackLinkOutcome> {
    const record: CallbackAuditRecord = {
      userId,
      connectionId: assertion.connectionId,
      provider: assertion.provider,
      subject: assertion.subject,
      domain: identifierDomain(normalizedEmail),
    };
    this.audit.linkAttempted(record);
    await this.directory.linkProviderAccount({
      userId,
      connectionId: assertion.connectionId,
      provider: assertion.provider,
      subject: assertion.subject,
      normalizedEmail,
    });
    this.audit.linkRecorded(record);
    return { kind: "linked", userId, linked: true };
  }

  private async propose({
    assertion,
    normalizedEmail,
    userId,
    reason,
  }: {
    assertion: CallbackAssertion;
    normalizedEmail: string;
    userId: string;
    reason: LinkProposalReason;
  }): Promise<void> {
    await this.proposals.proposeLink({
      tenantId: userId,
      userId,
      commandId: this.clock.newCommandId(),
      proposalId: this.newProposalId(),
      connectionId: assertion.connectionId,
      provider: assertion.provider,
      providerAccountId: assertion.subject,
      value: normalizedEmail,
      reason,
      occurredAtMs: this.clock.now(),
      actor: { type: "system", id: null },
    });
  }

  /**
   * Somebody the connection has never seen, and what it does about them.
   *
   * The account is created in two of the three cases, and it is the same
   * account either way: signing in successfully and being told to do it again
   * later is not a thing to put a person through, and an administrator
   * answering a request needs somebody to answer ABOUT. What differs is
   * whether they are a member when they land.
   *
   * An assertion with no address at all is refused whatever the policy says.
   * Every downstream question — which domain admitted them, who to tell, what
   * to show an administrator deciding — is asked of the address, and there is
   * no answer to give without one.
   */
  private async provision(
    assertion: CallbackAssertion,
    normalizedEmail: string | null,
  ): Promise<CallbackLinkOutcome> {
    if (assertion.arrivalPolicy === "refuse" || !normalizedEmail) {
      throw new IdentityJitDisabledError();
    }
    const { userId } = await this.directory.provisionUser({
      connectionId: assertion.connectionId,
      provider: assertion.provider,
      subject: assertion.subject,
      normalizedEmail,
      // A membership, or an account and a request for one. The directory
      // knows how to make both; this decides which was asked for.
      membership: assertion.arrivalPolicy === "admit" ? "join" : "request",
    });
    return assertion.arrivalPolicy === "admit"
      ? { kind: "provisioned", userId, linked: true }
      : { kind: "awaiting_approval", userId, linked: true };
  }
}
