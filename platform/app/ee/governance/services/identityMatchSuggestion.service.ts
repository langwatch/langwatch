// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The background job that works out who a provider-named person MIGHT be
 * (ADR-128 §12).
 *
 * BACKGROUND ONLY. Nothing that answers an HTTP request may reach this file or
 * the scorer it uses, and a test walks the import graph to prove it. The reason
 * is measured: at ADR-128's own example size — 2,000 discovered people against
 * 500 accounts — the million pairs took 2.9 seconds of blocked event loop, per
 * page load, uncached, stalling every other request on the instance. Storing
 * rows also makes a pending count answerable without paying for the sweep,
 * which a compute-at-read design cannot do at any price.
 *
 * A suggestion links nobody. It is a question put to a person, and the answer
 * is the only thing that opens a link (`IdentityMatchService.confirmSuggestion`).
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
  isWorthScoring,
  nameSimilarity,
  SUGGESTION_THRESHOLD,
} from "./logic/nameSimilarity";

const logger = createLogger("langwatch:governance:identity-suggestions");

/**
 * How many candidates one person may put in the review queue.
 *
 * A name that resembles nine colleagues is not nine questions worth asking; it
 * is one hard question, and showing the nine best guesses is how a review queue
 * becomes something nobody finishes. Ordered by score, so the cap keeps the
 * strongest.
 */
export const MAX_SUGGESTIONS_PER_PERSON = 5;

/** What one pass of the job did, and how much work the prefilter saved. */
export interface SuggestionPassOutcome {
  /** Discovered people considered — unlinked, unsuspended, unerased, human. */
  peopleConsidered: number;
  /** Pairs the prefilter admitted to the scorer. */
  pairsScored: number;
  /** Candidates written to the review queue. */
  suggestionsWritten: number;
  /** Candidates from an earlier pass the new inputs no longer imply. */
  suggestionsRemoved: number;
}

/**
 * One discovered person against the whole roster: how many pairs the prefilter
 * let through, and the few candidates worth asking about.
 *
 * The two numbers are reported separately because together they say which gate
 * did the work — a pass where everything was scored and nothing kept means the
 * prefilter has stopped filtering, which is invisible from either count alone.
 */
function scoreAgainstMembers({
  displayText,
  members,
}: {
  displayText: string;
  members: readonly { userId: string; name: string }[];
}): {
  pairsScored: number;
  kept: { userId: string; score: number }[];
} {
  let pairsScored = 0;
  const scored: { userId: string; score: number }[] = [];

  for (const member of members) {
    // The prefilter runs first and is the whole reason this pass is affordable:
    // two names from one organization's roster almost never share a word by
    // accident, so the vast majority of pairs never reach the edit distance.
    if (!isWorthScoring(displayText, member.name)) continue;
    pairsScored += 1;
    const score = nameSimilarity(displayText, member.name);
    if (score === null || score < SUGGESTION_THRESHOLD) continue;
    scored.push({ userId: member.userId, score });
  }

  // Strongest first, so the cap keeps the best candidates rather than whichever
  // ones the roster happened to list first. The id breaks ties, so two members
  // scoring identically produce the same queue on every pass.
  scored.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return { pairsScored, kept: scored.slice(0, MAX_SUGGESTIONS_PER_PERSON) };
}

export interface IdentityMatchSuggestionDeps {
  prisma: PrismaClient;
  discoveredPeople?: DiscoveredPersonRepository;
  matches?: IdentityMatchRepository;
  suggestions?: IdentityMatchSuggestionRepository;
  accounts?: OrganizationAccountDirectoryRepository;
  now?: () => Date;
}

export class IdentityMatchSuggestionService {
  private readonly prisma: PrismaClient;
  private readonly discoveredPeople: DiscoveredPersonRepository;
  private readonly matches: IdentityMatchRepository;
  private readonly suggestions: IdentityMatchSuggestionRepository;
  private readonly accounts: OrganizationAccountDirectoryRepository;
  private readonly now: () => Date;

  constructor(deps: IdentityMatchSuggestionDeps) {
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

  static create(prisma: PrismaClient): IdentityMatchSuggestionService {
    return new IdentityMatchSuggestionService({ prisma });
  }

  /**
   * Recomputes one organization's review queue from scratch.
   *
   * From scratch rather than incrementally, and the queue is swapped in one
   * transaction. A row the new inputs no longer imply — a person since linked,
   * an account that left, a name that was corrected — is a decision that no
   * longer means anything, and leaving it is how a queue fills with noise.
   *
   * Already-linked people are skipped here rather than filtered downstream:
   * scoring them is the expensive part, and the answer is discarded either way.
   */
  async recompute({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SuggestionPassOutcome> {
    const [people, openLinks, members] = await Promise.all([
      this.discoveredPeople.findMatchable(this.prisma, { organizationId }),
      this.matches.findOpenByOrganization(this.prisma, { organizationId }),
      this.accounts.findMemberNames(this.prisma, { organizationId }),
    ]);

    const linkedPeople = new Set(
      openLinks.map((link) => link.discoveredPersonId),
    );
    const candidates = people.filter((person) => !linkedPeople.has(person.id));

    let pairsScored = 0;
    const suggestions: {
      discoveredPersonId: string;
      userId: string;
      score: number;
    }[] = [];

    for (const person of candidates) {
      const scored = scoreAgainstMembers({
        displayText: person.displayText,
        members,
      });
      pairsScored += scored.pairsScored;
      for (const candidate of scored.kept) {
        suggestions.push({
          discoveredPersonId: person.id,
          userId: candidate.userId,
          score: candidate.score,
        });
      }
    }

    const { removed, written } = await this.suggestions.replaceForOrganization(
      this.prisma,
      { organizationId, suggestions, computedAt: this.now() },
    );

    logger.info(
      {
        organizationId,
        peopleConsidered: candidates.length,
        pairsScored,
        suggestionsWritten: written,
        suggestionsRemoved: removed,
      },
      "Recomputed identity match suggestions",
    );

    return {
      peopleConsidered: candidates.length,
      pairsScored,
      suggestionsWritten: written,
      suggestionsRemoved: removed,
    };
  }
}
