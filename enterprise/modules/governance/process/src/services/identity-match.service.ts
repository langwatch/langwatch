// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  IdentityAlreadyLinkedError,
  IdentityErasedError,
  IdentityMatchSuggestionNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import type { DiscoveredPersonRepository } from "../repositories/discovered-person.repository.ts";
import type {
  IdentityMatchSuggestionRepository,
  IdentityMatchSuggestionRow,
} from "../repositories/identity-match-suggestion.repository.ts";
import type { IdentityMatchRepository } from "../repositories/identity-match.repository.ts";
import {
  decideMatch,
  MATCH_EVIDENCE_KIND,
  normalizeEmail,
  type OrganizationAccountIndex,
} from "../rules/identity-evidence.rules.ts";
import { isUniqueViolation } from "../rules/postgres-constraint.rules.ts";

/** What one pass over an organization's discovered people did. */
export interface AutoLinkOutcome {
  linked: number;
  suspended: number;
  /** Nothing proved them: most are contractors with no account, but it is also a broken directory. */
  unproven: number;
}

export interface IdentityMatchDependencies {
  discoveredPeople: DiscoveredPersonRepository;
  matches: IdentityMatchRepository;
  suggestions: IdentityMatchSuggestionRepository;
  organizations: Pick<OrganizationApi, "findMembersIncludingDeactivated">;
  directory: Pick<ScimApi, "findDirectoryExternalIds">;
  now?: () => Instant;
  logger?: Logger;
}

/**
 * Links provider-named people to accounts on proof alone; a guess links nothing, and contradiction
 * halts the person for a human (ADR-128 §12). Scoring lives in IdentityMatchSuggestionService.
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
export class IdentityMatchService {
  private readonly logger: Logger;
  private readonly now: () => Instant;

  private constructor(private readonly deps: IdentityMatchDependencies) {
    this.logger = deps.logger ?? createLogger("langwatch:governance:identity-match");
    this.now = deps.now ?? nowInstant;
  }

  static create(deps: IdentityMatchDependencies): IdentityMatchService {
    return new IdentityMatchService(deps);
  }

  /** Both indexes the evidence rules read, built once per organization rather than per person. */
  async loadAccountIndex({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<OrganizationAccountIndex> {
    const [members, directoryIds] = await Promise.all([
      this.deps.organizations.findMembersIncludingDeactivated({ organizationId }),
      this.deps.directory.findDirectoryExternalIds({ organizationId }),
    ]);

    const usersByVerifiedEmail = new Map<string, string[]>();
    for (const { id: userId, email, emailVerified } of members) {
      // An unconfirmed address is a claim anyone can type into a profile, so it proves nothing.
      if (!emailVerified || !email) continue;
      const key = normalizeEmail(email);
      if (key === null) continue;
      usersByVerifiedEmail.set(key, [...(usersByVerifiedEmail.get(key) ?? []), userId]);
    }

    const usersByDirectoryId = new Map<string, string[]>();
    for (const { userId, externalId } of directoryIds) {
      usersByDirectoryId.set(externalId, [...(usersByDirectoryId.get(externalId) ?? []), userId]);
    }

    return { usersByVerifiedEmail, usersByDirectoryId };
  }

  /**
   * Acts on whatever the evidence proves, idempotently: an agreeing link is silence and a halted
   * person is not read. One person's failure, such as a concurrent pass winning the link, does not
   * end the pass.
   */
  async linkProvenMatches({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<AutoLinkOutcome> {
    const accounts = await this.loadAccountIndex({ organizationId });
    const [people, openLinks] = await Promise.all([
      this.deps.discoveredPeople.findMatchable({ organizationId }),
      this.deps.matches.findOpenByOrganization({ organizationId }),
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
    at: Instant;
  }): Promise<number> {
    this.logger.warn(
      {
        organizationId,
        discoveredPersonId: person.id,
        provider: person.provider,
        reason,
        candidateCount,
      },
      "Contradictory identity evidence; automatic linking halted for this person",
    );
    return this.deps.discoveredPeople.suspend({
      id: person.id,
      organizationId,
      at,
      reason,
    });
  }

  /** 1 or 0: the person is re-read at the moment of writing, since an erasure can finish mid-pass. */
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
    at: Instant;
  }): Promise<number> {
    const person = await this.deps.discoveredPeople.findById({
      id: discoveredPersonId,
      organizationId,
    });
    if (!person || person.erasedAt) {
      this.logger.info(
        { organizationId, discoveredPersonId },
        "The person was erased while this pass was running; leaving them unlinked",
      );
      return 0;
    }

    try {
      await this.deps.matches.open({
        organizationId,
        discoveredPersonId,
        userId,
        evidenceKind,
        validFrom: at,
      });
      return 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      this.logger.info(
        { organizationId, discoveredPersonId },
        "A concurrent pass had already opened this link; leaving it as it is",
      );
      return 0;
    }
  }

  /** One organization's review queue, strongest candidate first. */
  async listSuggestions({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<IdentityMatchSuggestionRow[]> {
    return this.deps.suggestions.findAllByOrganization({ organizationId });
  }

  /**
   * Turns one suggestion into a `human_confirmed` link and clears every candidate for the person.
   * Refuses a suggestion that is gone, a person since erased, and a person already linked.
   */
  async confirmSuggestion({
    organizationId,
    suggestionId,
  }: {
    organizationId: string;
    suggestionId: string;
  }): Promise<{ discoveredPersonId: string; userId: string }> {
    const suggestion = await this.deps.suggestions.findOne({ id: suggestionId, organizationId });
    if (!suggestion) throw new IdentityMatchSuggestionNotFoundError(suggestionId);

    const person = await this.deps.discoveredPeople.findById({
      id: suggestion.discoveredPersonId,
      organizationId,
    });
    if (!person) throw new IdentityMatchSuggestionNotFoundError(suggestionId);
    if (person.erasedAt) throw new IdentityErasedError(suggestion.discoveredPersonId);

    const openLinks = await this.deps.matches.findOpenByOrganization({ organizationId });
    if (openLinks.some((link) => link.discoveredPersonId === suggestion.discoveredPersonId)) {
      throw new IdentityAlreadyLinkedError(suggestion.discoveredPersonId);
    }

    try {
      await this.deps.matches.open({
        organizationId,
        discoveredPersonId: suggestion.discoveredPersonId,
        userId: suggestion.userId,
        evidenceKind: MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED,
        validFrom: this.now(),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new IdentityAlreadyLinkedError(suggestion.discoveredPersonId);
      }
      throw error;
    }

    await this.deps.suggestions.deleteAllForPerson({
      organizationId,
      discoveredPersonId: suggestion.discoveredPersonId,
    });

    return { discoveredPersonId: suggestion.discoveredPersonId, userId: suggestion.userId };
  }
}
