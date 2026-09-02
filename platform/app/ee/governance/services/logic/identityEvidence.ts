// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What counts as proof that a provider-named person is a LangWatch account, and
 * what to do when the proof disagrees with itself (ADR-128 §12).
 *
 * Pure, and deliberately so: this is the file where "we linked the wrong two
 * people" would happen, and it is the only part of the match engine worth
 * reading on its own. No database, no clock, no organization — the caller
 * gathers the evidence, this decides what it proves.
 *
 * The rule in one line: an address somebody confirmed links; anything else
 * either corroborates a link the address already made, or stops the machine.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */

/**
 * How a link was proved, recorded on the `IdentityMatch` row that carries it.
 *
 * An enumerated vocabulary rather than free text, because ADR-128 §22 needs
 * these values to map onto the pull-mode architecture map's
 * `x_PersonResolutionMethod` by lookup and never by re-derivation. A compound
 * case therefore gets its own value rather than being assembled from two.
 */
export const MATCH_EVIDENCE_KIND = {
  /**
   * An address the account holder confirmed, equal to one the provider sent.
   * The primary evidence, and the only kind that opens a link by itself.
   */
  VERIFIED_EMAIL: "verified_email",
  /**
   * The same, plus the identity provider's own identifier for that person
   * agreeing with it. Proved twice, and worth saying so on the row: a reviewer
   * auditing a link should not have to re-run the directory to find out whether
   * it agreed at the time.
   */
  VERIFIED_EMAIL_AND_DIRECTORY_ID: "verified_email_and_directory_id",
  /**
   * The identity provider's identifier alone. Declared because the vocabulary
   * describes the evidence space rather than only the outcomes we act on —
   * nothing in this engine ever writes it, and `decideMatch` is where that is
   * enforced. These identifiers exist only for people the identity provider
   * created, they refresh daily, and Databricks — whose data this rule was
   * written against — advises against building on them.
   */
  DIRECTORY_ID: "directory_id",
  /** A person looked at a suggestion and said yes. */
  HUMAN_CONFIRMED: "human_confirmed",
} as const;

export type MatchEvidenceKind =
  (typeof MATCH_EVIDENCE_KIND)[keyof typeof MATCH_EVIDENCE_KIND];

/** Why automatic linking stopped, in words the human reviewing it can act on. */
export const MATCH_SUSPENSION_REASON = {
  /**
   * Shared mailboxes, and addresses re-issued to new hires. Re-issue survives
   * on its own because links are dated — the leaver's closes, the new hire's
   * opens — but two accounts holding one address *at once* is not something
   * dates resolve.
   */
  AMBIGUOUS_EMAIL: "ambiguous_verified_email",
  /**
   * The directory and the address name different people. One of the two is
   * stale or wrong and no rule here can tell which, so neither is trusted.
   */
  DIRECTORY_DISAGREES: "directory_disagrees_with_email",
  /**
   * The evidence now names a different account than the open link does. Either
   * the link is stale or the evidence is; overwriting one with the other
   * silently is how somebody's spend moves to somebody else's name.
   */
  CONTRADICTS_OPEN_LINK: "contradicts_open_link",
} as const;

export type MatchSuspensionReason =
  (typeof MATCH_SUSPENSION_REASON)[keyof typeof MATCH_SUSPENSION_REASON];

/** What one provider row said about somebody, reduced to the two join keys. */
export interface DiscoveredIdentity {
  /** What the provider calls them — an address, a directory id, or an opaque id. */
  rawActorId: string;
  /** The name or address text as seen, which is often the other of the two. */
  displayText: string;
  /**
   * The account this person is already linked to, if any. Null covers both "no
   * link" and "a link the erasure blanked", which want the same treatment: there
   * is nothing to contradict.
   */
  openLinkUserId?: string | null;
}

/**
 * Every account in the organization the evidence could point at, indexed the
 * two ways the evidence arrives.
 *
 * Both maps are built by the caller from its own reads, which is what keeps
 * this file free of Prisma and free of the question "is this address
 * confirmed?" — an unconfirmed address never reaches the map.
 */
export interface OrganizationAccountIndex {
  /** Normalized confirmed address to the accounts holding it. */
  usersByVerifiedEmail: ReadonlyMap<string, readonly string[]>;
  /** Directory identifier to the accounts carrying it. */
  usersByDirectoryId: ReadonlyMap<string, readonly string[]>;
}

/** Open a link, and say what proved it. */
export interface AutoLinkDecision {
  outcome: "link";
  userId: string;
  evidenceKind: MatchEvidenceKind;
}

/** Stop, and flag a human. Stored on the person, never in the job's output. */
export interface SuspendDecision {
  outcome: "suspend";
  reason: MatchSuspensionReason;
  /** The accounts the evidence pointed at, so a reviewer sees the collision. */
  candidateUserIds: string[];
}

/**
 * Nothing to do. Either nothing proved anything — the suggestion job may still
 * have an opinion — or the proof agrees with the link that is already open.
 */
export interface NoActionDecision {
  outcome: "no_action";
}

export type MatchDecision =
  | AutoLinkDecision
  | SuspendDecision
  | NoActionDecision;

/**
 * An address, lowercased and trimmed, or null when the text is not one.
 *
 * Deliberately strict rather than clever. This is the primary evidence for
 * linking a person to an account without anybody looking, so a permissive
 * parser that accepts `maria` or `Maria Silva <m@x.com>` is a parser that
 * manufactures matches. One `@`, something either side, a dot in the domain,
 * no whitespace.
 *
 * Lowercasing the whole address is a deliberate simplification: the local part
 * is case-sensitive per RFC 5321, and no mail provider anybody connects here
 * treats it that way — while a cost provider reporting `M.Silva@acme.com` where
 * the directory holds `m.silva@acme.com` is the common case, not the exotic one.
 */
export function normalizeEmail(text: string): string | null {
  const trimmed = text.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

/** The candidate accounts a key resolves to, de-duplicated and order-stable. */
function lookup(
  index: ReadonlyMap<string, readonly string[]>,
  key: string | null,
): string[] {
  if (key === null) return [];
  return [...new Set(index.get(key) ?? [])];
}

/**
 * Decide what the evidence proves about one discovered person.
 *
 * Both provider-supplied strings are tried against both indexes, because
 * providers disagree about which field holds what: OpenAI puts the address in
 * `user_email` and an opaque id in `user_id`, Databricks puts the address in the
 * id field itself, and Anthropic puts an opaque member id in both. Trying only
 * the field we expected would silently match nobody for two of the three.
 *
 * The answers, in the order they are decided:
 *
 *  - **Two accounts confirmed the same address** — halt. Dates rescue a
 *    re-issued address; they do not rescue two live holders of one.
 *  - **The directory names somebody the address does not** — halt. One of the
 *    two is stale and nothing here can tell which.
 *  - **The proof names an account the open link does not** — halt, for the same
 *    reason: silently re-pointing a link moves one person's spend onto another.
 *  - **One account, by confirmed address, and no open link** — link, recording
 *    whether the directory agreed as well.
 *
 * Everything else is no action, which explicitly includes a directory
 * identifier matching exactly one account and nothing else agreeing with it:
 * that is the case the "never stands alone" rule exists for.
 */
export function decideMatch({
  identity,
  accounts,
}: {
  identity: DiscoveredIdentity;
  accounts: OrganizationAccountIndex;
}): MatchDecision {
  const emailCandidates = [
    ...new Set(
      [
        normalizeEmail(identity.rawActorId),
        normalizeEmail(identity.displayText),
      ].flatMap((key) => lookup(accounts.usersByVerifiedEmail, key)),
    ),
  ];

  if (emailCandidates.length > 1) {
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.AMBIGUOUS_EMAIL,
      candidateUserIds: emailCandidates,
    };
  }

  // The raw values, not the parsed ones: a directory identifier is opaque, and
  // normalizing it as an address would drop every one that is not shaped like
  // one — which is all of them.
  const directoryCandidates = [
    ...new Set(
      [identity.rawActorId, identity.displayText].flatMap((key) =>
        lookup(accounts.usersByDirectoryId, key),
      ),
    ),
  ];

  const [emailUserId] = emailCandidates;

  if (emailUserId === undefined) {
    // A directory identifier and nothing else. It corroborates; it does not
    // prove. Two of them disagreeing is likewise not a halt, because neither
    // was going to link anybody on its own — halting there would flag a human
    // over evidence we had already decided not to act on.
    return { outcome: "no_action" };
  }

  if (
    directoryCandidates.length > 0 &&
    !directoryCandidates.includes(emailUserId)
  ) {
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.DIRECTORY_DISAGREES,
      candidateUserIds: [...new Set([emailUserId, ...directoryCandidates])],
    };
  }

  const openLinkUserId = identity.openLinkUserId ?? null;
  if (openLinkUserId !== null) {
    // Agreeing with what is already there is the overwhelmingly common case —
    // every subsequent pass over an already-linked person lands here — so it is
    // silence, not a write. Disagreeing is the rare one, and it is a halt.
    if (openLinkUserId === emailUserId) return { outcome: "no_action" };
    return {
      outcome: "suspend",
      reason: MATCH_SUSPENSION_REASON.CONTRADICTS_OPEN_LINK,
      candidateUserIds: [openLinkUserId, emailUserId],
    };
  }

  return {
    outcome: "link",
    userId: emailUserId,
    evidenceKind: directoryCandidates.includes(emailUserId)
      ? MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID
      : MATCH_EVIDENCE_KIND.VERIFIED_EMAIL,
  };
}
