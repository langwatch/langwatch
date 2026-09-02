// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Linking provider-named people to LangWatch accounts (ADR-128 §12).
 *
 * Two halves, and the whole design is the line between them. Proof links by
 * itself — a 500-person organization should not click 500 times to confirm what
 * the directory already proves, and until it clicked, every one of those
 * people's spend would read "unknown person". A guess links nothing, ever: a
 * wrong guess routes somebody's money to somebody else's name and says nothing
 * about it, which is worse than reading "unknown".
 *
 * Contradiction is the third answer and it stops the machine rather than
 * picking. Two accounts confirming one address, a directory naming somebody the
 * address does not, evidence disagreeing with an open link — each halts
 * automatic linking for that person and flags a human. The halt is stored on
 * the person rather than in this pass's output, because a halt that the next
 * recompute clears is not a halt.
 *
 * The scoring half lives in the background job next door
 * (`identityMatchSuggestion.service.ts`) and never in this file's reach — see
 * `nameSimilarity.ts` for why that boundary is measured rather than tasteful.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
import { createLogger } from "@langwatch/observability";

import type { PrismaClient } from "~/generated/prisma/client";

import {
  DiscoveredPersonRepository,
  IdentityMatchRepository,
  IdentityMatchSuggestionRepository,
  OrganizationAccountDirectoryRepository,
} from "../repositories/governanceIdentity.repository";
import {
  IdentityAlreadyLinkedError,
  IdentityErasedError,
  IdentityMatchSuggestionNotFoundError,
  isExclusionViolation,
} from "./identityMatch.errors";
import {
  decideMatch,
  MATCH_EVIDENCE_KIND,
  normalizeEmail,
  type OrganizationAccountIndex,
} from "./logic/identityEvidence";

const logger = createLogger("langwatch:governance:identity-match");

/** What one pass over an organization's discovered people did. */
export interface AutoLinkOutcome {
  /** People the evidence proved, now carrying an open link. */
  linked: number;
  /** People whose evidence contradicted itself; automatic linking halted. */
  suspended: number;
  /**
   * People nothing proved. Not a failure — most discovered people are
   * contractors and seat holders who have no account here at all — but worth
   * reporting, because it is also what a misconfigured directory looks like.
   */
  unproven: number;
}

export interface IdentityMatchDeps {
  prisma: PrismaClient;
  discoveredPeople?: DiscoveredPersonRepository;
  matches?: IdentityMatchRepository;
  suggestions?: IdentityMatchSuggestionRepository;
  accounts?: OrganizationAccountDirectoryRepository;
  now?: () => Date;
}

export class IdentityMatchService {
  private readonly prisma: PrismaClient;
  private readonly discoveredPeople: DiscoveredPersonRepository;
  private readonly matches: IdentityMatchRepository;
  private readonly suggestions: IdentityMatchSuggestionRepository;
  private readonly accounts: OrganizationAccountDirectoryRepository;
  private readonly now: () => Date;

  constructor(deps: IdentityMatchDeps) {
    this.prisma = deps.prisma;
    this.discoveredPeople =
      deps.discoveredPeople ?? new DiscoveredPersonRepository();
    this.matches = deps.matches ?? new IdentityMatchRepository();
    this.suggestions =
      deps.suggestions ?? new IdentityMatchSuggestionRepository();
    this.accounts =
      deps.accounts ?? new OrganizationAccountDirectoryRepository();
    this.now = deps.now ?? (() => new Date());
  }

  static create(prisma: PrismaClient): IdentityMatchService {
    return new IdentityMatchService({ prisma });
  }

  /**
   * Builds the two indexes the evidence rules read, in three queries for the
   * whole organization rather than three per person.
   *
   * Public because the suggestion job needs the same accounts and building them
   * twice would double the cost of a pass that already walks both populations.
   */
  async loadAccountIndex({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationAccountIndex> {
    const [emails, directoryIds] = await Promise.all([
      this.accounts.findVerifiedMemberEmails(this.prisma, { organizationId }),
      this.accounts.findDirectoryIds(this.prisma, { organizationId }),
    ]);

    const usersByVerifiedEmail = new Map<string, string[]>();
    for (const { userId, email } of emails) {
      // Through the same normalizer the provider side goes through, so a
      // directory holding `M.Silva@acme.com` and a bill reporting
      // `m.silva@acme.com` land on one key rather than two.
      const key = normalizeEmail(email);
      if (key === null) continue;
      usersByVerifiedEmail.set(key, [
        ...(usersByVerifiedEmail.get(key) ?? []),
        userId,
      ]);
    }

    const usersByDirectoryId = new Map<string, string[]>();
    for (const { userId, externalId } of directoryIds) {
      usersByDirectoryId.set(externalId, [
        ...(usersByDirectoryId.get(externalId) ?? []),
        userId,
      ]);
    }

    return { usersByVerifiedEmail, usersByDirectoryId };
  }

  /**
   * Walks the organization's discovered people and acts on whatever the
   * evidence proves.
   *
   * Idempotent by construction: a person the last pass linked agrees with their
   * own open link and is silence, and a person the last pass halted is filtered
   * out of the read entirely. So this is safe to run on a schedule, which is
   * how it runs.
   *
   * One person's failure does not end the pass. A link refused by the database
   * because a concurrent pass opened it first is exactly what the constraint is
   * for, and stopping there would leave the rest of the organization unmatched
   * until the next run.
   */
  async linkProvenMatches({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AutoLinkOutcome> {
    const accounts = await this.loadAccountIndex({ organizationId });
    const [people, openLinks] = await Promise.all([
      this.discoveredPeople.findMatchable(this.prisma, { organizationId }),
      this.matches.findOpenByOrganization(this.prisma, { organizationId }),
    ]);

    const openLinkByPerson = new Map(
      openLinks.map((link) => [link.discoveredPersonId, link.userId]),
    );
    const at = this.now();
    const outcome: AutoLinkOutcome = { linked: 0, suspended: 0, unproven: 0 };

    for (const person of people) {
      const openLinkUserId = openLinkByPerson.get(person.id) ?? null;
      const decision = decideMatch({
        identity: {
          rawActorId: person.rawActorId,
          displayText: person.displayText,
          openLinkUserId,
        },
        accounts,
      });

      if (decision.outcome === "no_action") {
        // Already linked and still agreeing is not "unproven" — counting it as
        // such would make the number grow with every successful match.
        if (openLinkUserId === null) outcome.unproven += 1;
      } else if (decision.outcome === "suspend") {
        outcome.suspended += await this.halt({
          organizationId,
          person,
          reason: decision.reason,
          candidateCount: decision.candidateUserIds.length,
          at,
        });
      } else {
        outcome.linked += await this.openProvenLink({
          organizationId,
          discoveredPersonId: person.id,
          userId: decision.userId,
          evidenceKind: decision.evidenceKind,
          at,
        });
      }
    }

    return outcome;
  }

  /** Records the halt, and says so loudly enough that somebody goes and looks. */
  private async halt({
    organizationId,
    person,
    reason,
    candidateCount,
    at,
  }: {
    organizationId: string;
    person: { id: string; provider: string };
    reason: string;
    candidateCount: number;
    at: Date;
  }): Promise<number> {
    logger.warn(
      {
        organizationId,
        discoveredPersonId: person.id,
        provider: person.provider,
        reason,
        candidateCount,
      },
      "Contradictory identity evidence; automatic linking halted for this person",
    );
    return await this.discoveredPeople.suspend(this.prisma, {
      id: person.id,
      organizationId,
      at,
      reason,
    });
  }

  /**
   * Opens one proven link, reporting 1 or 0 rather than throwing on the single
   * failure that is not one.
   *
   * A concurrent pass beating this one to the same link raises the exclusion
   * violation, which is the rule holding rather than breaking. Ending the whole
   * pass there would leave everybody after this person unmatched until the next
   * night.
   */
  private async openProvenLink({
    organizationId,
    discoveredPersonId,
    userId,
    evidenceKind,
    at,
  }: {
    organizationId: string;
    discoveredPersonId: string;
    userId: string;
    evidenceKind: string;
    at: Date;
  }): Promise<number> {
    try {
      await this.matches.open(this.prisma, {
        organizationId,
        discoveredPersonId,
        userId,
        evidenceKind,
        // The instant we could first prove it, not the instant the person first
        // appeared: dating the link back to `firstSeenAt` would claim we knew
        // something we did not, and a re-issued address makes that claim
        // actively wrong.
        validFrom: at,
      });
      return 1;
    } catch (error) {
      if (!isExclusionViolation(error)) throw error;
      logger.info(
        { organizationId, discoveredPersonId },
        "A concurrent pass had already opened this link; leaving it as it is",
      );
      return 0;
    }
  }

  /** One organization's review queue, strongest candidate first. */
  async listSuggestions({ organizationId }: { organizationId: string }) {
    return await this.suggestions.findAllByOrganization(this.prisma, {
      organizationId,
    });
  }

  /**
   * Turns one suggestion into a link, on a person's say-so.
   *
   * The evidence recorded is `human_confirmed` and never the score that
   * surfaced the candidate: a score is why we asked, not why the link is true.
   *
   * Confirming clears EVERY candidate for that person, not only the confirmed
   * row — they now hold a link, so the rest are decisions nobody will make.
   *
   * Three refusals, and the erased one is not decoration. The automatic pass
   * cannot reach an erased person — the read filters them out — but this path
   * is a human clicking a row they were shown, and a row shown before an
   * erasure can be clicked after it. The erasure deletes pending suggestions
   * for exactly that reason; this check is what covers the interval where a
   * queue is already on somebody's screen.
   */
  async confirmSuggestion({
    organizationId,
    suggestionId,
  }: {
    organizationId: string;
    suggestionId: string;
  }): Promise<{ discoveredPersonId: string; userId: string }> {
    const suggestion = await this.suggestions.findOne(this.prisma, {
      id: suggestionId,
      organizationId,
    });
    if (!suggestion) {
      throw new IdentityMatchSuggestionNotFoundError(suggestionId);
    }

    // Read the person rather than trusting the suggestion, because the whole
    // point is that the suggestion is older than the answer.
    const person = await this.discoveredPeople.findById(this.prisma, {
      id: suggestion.discoveredPersonId,
      organizationId,
    });
    if (!person) {
      // The row is gone. Nothing to link, and nothing more specific to say
      // than that the thing being confirmed no longer exists.
      throw new IdentityMatchSuggestionNotFoundError(suggestionId);
    }
    if (person.erasedAt) {
      throw new IdentityErasedError(suggestion.discoveredPersonId);
    }

    const openLinks = await this.matches.findOpenByOrganization(this.prisma, {
      organizationId,
    });
    if (
      openLinks.some(
        (link) => link.discoveredPersonId === suggestion.discoveredPersonId,
      )
    ) {
      // The queue was read before somebody else acted on it. Say which rule
      // refused rather than leaving a reviewer with an unknown error.
      throw new IdentityAlreadyLinkedError(suggestion.discoveredPersonId);
    }

    try {
      await this.matches.open(this.prisma, {
        organizationId,
        discoveredPersonId: suggestion.discoveredPersonId,
        userId: suggestion.userId,
        evidenceKind: MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED,
        validFrom: this.now(),
      });
    } catch (error) {
      // Two reviewers confirming at once: the read above passed for both and
      // the exclusion constraint refused the second. Same sentence either way —
      // the check and the constraint hold one rule between them.
      if (isExclusionViolation(error)) {
        throw new IdentityAlreadyLinkedError(suggestion.discoveredPersonId);
      }
      throw error;
    }

    await this.suggestions.deleteAllForPerson(this.prisma, {
      organizationId,
      discoveredPersonId: suggestion.discoveredPersonId,
    });

    return {
      discoveredPersonId: suggestion.discoveredPersonId,
      userId: suggestion.userId,
    };
  }
}
