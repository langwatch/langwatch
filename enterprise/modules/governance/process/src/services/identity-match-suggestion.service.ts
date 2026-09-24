// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger, type Logger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import type { OrganizationMembersChannel } from "../channels/organization-members.channel.ts";
import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type { IdentityMatchSuggestionRepository } from "../repositories/identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "../repositories/identity-match.repository.ts";
import {
  isWorthScoring,
  nameSimilarity,
  SUGGESTION_THRESHOLD,
} from "../rules/name-similarity.rules.ts";

/** A name resembling nine colleagues is one hard question, not nine; the strongest are kept. */
export const MAX_SUGGESTIONS_PER_PERSON = 5;

/** What one pass did, and how much work the prefilter saved. */
export interface SuggestionPassOutcome {
  peopleConsidered: number;
  pairsScored: number;
  suggestionsWritten: number;
  suggestionsRemoved: number;
}

function scoreAgainstMembers({
  displayText,
  members,
}: {
  displayText: string;
  members: readonly { userId: string; name: string }[];
}): { pairsScored: number; kept: { userId: string; score: number }[] } {
  let pairsScored = 0;
  const scored: { userId: string; score: number }[] = [];

  for (const member of members) {
    if (!isWorthScoring(displayText, member.name)) continue;
    pairsScored += 1;
    const similarity = nameSimilarity(displayText, member.name);
    if (similarity.outcome !== "scored" || similarity.score < SUGGESTION_THRESHOLD) continue;
    scored.push({ userId: member.userId, score: similarity.score });
  }

  scored.sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId));
  return { pairsScored, kept: scored.slice(0, MAX_SUGGESTIONS_PER_PERSON) };
}

export interface IdentityMatchSuggestionDependencies {
  discoveredPeople: DiscoveredPersonRepository;
  matches: IdentityMatchRepository;
  suggestions: IdentityMatchSuggestionRepository;
  members: OrganizationMembersChannel;
  now?: () => Instant;
  logger?: Logger;
}

/**
 * The background job asking who a provider-named person MIGHT be; a suggestion links nobody.
 * Background only: the pair sweep blocks the event loop for seconds at ADR-128's example size.
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
export class IdentityMatchSuggestionService {
  private readonly logger: Logger;
  private readonly now: () => Instant;

  private constructor(private readonly deps: IdentityMatchSuggestionDependencies) {
    this.logger = deps.logger ?? createLogger("langwatch:governance:identity-suggestions");
    this.now = deps.now ?? nowInstant;
  }

  static create(deps: IdentityMatchSuggestionDependencies): IdentityMatchSuggestionService {
    return new IdentityMatchSuggestionService(deps);
  }

  /** Recomputes the queue from scratch and swaps it in whole; linked people are never scored. */
  async recompute({ organizationId }: { organizationId: string }): Promise<SuggestionPassOutcome> {
    const [people, openLinks, members] = await Promise.all([
      this.deps.discoveredPeople.findMatchable({ organizationId }),
      this.deps.matches.findOpenByOrganization({ organizationId }),
      this.deps.members.findMemberNames({ organizationId }),
    ]);

    const linkedPeople = new Set(openLinks.map((link) => link.discoveredPersonId));
    const candidates = people.filter((person) => !linkedPeople.has(person.id));

    let pairsScored = 0;
    const suggestions: { discoveredPersonId: string; userId: string; score: number }[] = [];

    for (const person of candidates) {
      const scored = scoreAgainstMembers({ displayText: person.displayText, members });
      pairsScored += scored.pairsScored;
      for (const candidate of scored.kept) {
        suggestions.push({
          discoveredPersonId: person.id,
          userId: candidate.userId,
          score: candidate.score,
        });
      }
    }

    const { removed, written } = await this.deps.suggestions.replaceForOrganization({
      organizationId,
      suggestions,
      computedAt: this.now(),
    });

    const outcome: SuggestionPassOutcome = {
      peopleConsidered: candidates.length,
      pairsScored,
      suggestionsWritten: written,
      suggestionsRemoved: removed,
    };
    this.logger.info({ organizationId, ...outcome }, "Recomputed identity match suggestions");
    return outcome;
  }
}
