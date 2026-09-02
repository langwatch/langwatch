// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The match engine's own decisions — which people it is allowed to touch, what
 * it does when it must not link, and that a halt is a halt.
 *
 * The repositories are doubles rather than a database, because what is under
 * test is the orchestration: which read filters which population, and which
 * write follows which decision. The database's half of the rules
 * (`IdentityMatch`'s overlap constraint) has its own integration test, and the
 * evidence rules have their own unit test — this is the seam between them.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import {
  IdentityAlreadyLinkedError,
  IdentityMatchSuggestionNotFoundError,
} from "../identityMatch.errors";
import { IdentityMatchService } from "../identityMatch.service";
import { MATCH_EVIDENCE_KIND } from "../logic/identityEvidence";

const organizationId = "org_acme";
const at = new Date("2026-09-03T05:41:00.000Z");

type Person = {
  id: string;
  provider: string;
  rawActorId: string;
  displayText: string;
};

/**
 * Doubles for the four repositories, holding just enough state that a test can
 * assert on what was written rather than on which method was called.
 *
 * `findMatchable` returns whatever the test seeded — the exclusions it applies
 * in production (machine logins, halted people, erased people) are a WHERE
 * clause, so they are asserted against the real database in
 * `identityMatchEngine.integration.test.ts` and stated here by what the test
 * chooses to seed.
 */
const build = ({
  people = [],
  openLinks = [],
  emails = [],
  directoryIds = [],
  suggestions = [],
  openThrows,
}: {
  people?: Person[];
  openLinks?: { discoveredPersonId: string; userId: string | null }[];
  emails?: { userId: string; email: string }[];
  directoryIds?: { userId: string; externalId: string }[];
  suggestions?: {
    id: string;
    discoveredPersonId: string;
    userId: string;
  }[];
  openThrows?: unknown;
} = {}) => {
  const suspended: { id: string; reason: string; at: Date }[] = [];
  const opened: {
    discoveredPersonId: string;
    userId: string;
    evidenceKind: string;
    validFrom: Date;
  }[] = [];
  const deletedForPerson: string[] = [];

  const discoveredPeople = {
    findMatchable: vi.fn().mockResolvedValue(people),
    suspend: vi.fn(
      async (
        _client: unknown,
        params: { id: string; reason: string; at: Date },
      ) => {
        suspended.push({ id: params.id, reason: params.reason, at: params.at });
        return 1;
      },
    ),
  };
  const matches = {
    findOpenByOrganization: vi.fn().mockResolvedValue(openLinks),
    open: vi.fn(
      async (
        _client: unknown,
        params: {
          discoveredPersonId: string;
          userId: string;
          evidenceKind: string;
          validFrom: Date;
        },
      ) => {
        if (openThrows) throw openThrows;
        opened.push({
          discoveredPersonId: params.discoveredPersonId,
          userId: params.userId,
          evidenceKind: params.evidenceKind,
          validFrom: params.validFrom,
        });
        return params;
      },
    ),
  };
  const suggestionsRepo = {
    findAllByOrganization: vi.fn().mockResolvedValue(suggestions),
    findOne: vi.fn(
      async (_client: unknown, params: { id: string }) =>
        suggestions.find((row) => row.id === params.id) ?? null,
    ),
    deleteAllForPerson: vi.fn(
      async (_client: unknown, params: { discoveredPersonId: string }) => {
        deletedForPerson.push(params.discoveredPersonId);
        return 1;
      },
    ),
  };
  const accounts = {
    findVerifiedMemberEmails: vi.fn().mockResolvedValue(emails),
    findDirectoryIds: vi.fn().mockResolvedValue(directoryIds),
  };

  const service = new IdentityMatchService({
    prisma: {} as PrismaClient,
    discoveredPeople: discoveredPeople as never,
    matches: matches as never,
    suggestions: suggestionsRepo as never,
    accounts: accounts as never,
    now: () => at,
  });

  return {
    service,
    suspended,
    opened,
    deletedForPerson,
    matches,
    discoveredPeople,
  };
};

const person = (overrides: Partial<Person> = {}): Person => ({
  id: "dp_1",
  provider: "openai_admin",
  rawActorId: "m.silva@acme.test",
  displayText: "m.silva@acme.test",
  ...overrides,
});

describe("Feature: linking provider-named people to accounts on proof", () => {
  describe("given a person whose address a member has confirmed", () => {
    it("opens one link, dated from when we could first prove it", async () => {
      const { service, opened } = build({
        people: [person()],
        emails: [{ userId: "user_42", email: "m.silva@acme.test" }],
      });

      const outcome = await service.linkProvenMatches({ organizationId });

      expect(outcome).toEqual({ linked: 1, suspended: 0, unproven: 0 });
      expect(opened).toEqual([
        {
          discoveredPersonId: "dp_1",
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.VERIFIED_EMAIL,
          // Not the person's firstSeenAt: dating the link back to when the
          // provider first named them would claim we knew something we did
          // not, and a re-issued address makes that claim actively wrong.
          validFrom: at,
        },
      ]);
    });

    it("normalizes both sides, so a member's address stored in mixed case still matches", async () => {
      const { service, opened } = build({
        people: [person({ rawActorId: "m.silva@acme.test" })],
        emails: [{ userId: "user_42", email: "M.Silva@Acme.TEST" }],
      });

      await service.linkProvenMatches({ organizationId });

      expect(opened).toHaveLength(1);
    });
  });

  describe("given a person who already holds an open link to that same account", () => {
    /** @scenario "A person who is already linked is left alone" */
    it("opens no second link", async () => {
      const { service, opened, suspended } = build({
        people: [person()],
        openLinks: [{ discoveredPersonId: "dp_1", userId: "user_42" }],
        emails: [{ userId: "user_42", email: "m.silva@acme.test" }],
      });

      const outcome = await service.linkProvenMatches({ organizationId });

      expect(opened).toEqual([]);
      expect(suspended).toEqual([]);
      // Not counted as unproven either: that number would otherwise grow with
      // every successful match the engine has ever made.
      expect(outcome).toEqual({ linked: 0, suspended: 0, unproven: 0 });
    });
  });

  describe("given an address two members have both confirmed", () => {
    it("halts automatic linking for that person and links nobody", async () => {
      const { service, opened, suspended } = build({
        people: [
          person({
            rawActorId: "shared@acme.test",
            displayText: "shared@acme.test",
          }),
        ],
        emails: [
          { userId: "user_42", email: "shared@acme.test" },
          { userId: "user_77", email: "shared@acme.test" },
        ],
      });

      const outcome = await service.linkProvenMatches({ organizationId });

      expect(opened).toEqual([]);
      expect(suspended).toEqual([
        { id: "dp_1", reason: "ambiguous_verified_email", at },
      ]);
      expect(outcome).toEqual({ linked: 0, suspended: 1, unproven: 0 });
    });
  });

  describe("given a person nothing proves anything about", () => {
    it("reports them as unproven rather than treating it as a failure", async () => {
      // Most discovered people are contractors and seat holders with no account
      // here at all. This number is also what a misconfigured directory looks
      // like, which is why it is reported rather than swallowed.
      const { service, opened } = build({
        people: [
          person({ rawActorId: "user_opaque", displayText: "user_opaque" }),
        ],
      });

      const outcome = await service.linkProvenMatches({ organizationId });

      expect(opened).toEqual([]);
      expect(outcome).toEqual({ linked: 0, suspended: 0, unproven: 1 });
    });
  });

  describe("given a concurrent pass that opened the same link first", () => {
    it("carries on with the rest of the organization rather than ending the pass", async () => {
      // The exclusion constraint refusing the second write is the rule holding.
      // Ending the pass there would leave everybody after this person unmatched
      // until the next night.
      const { service } = build({
        people: [person()],
        emails: [{ userId: "user_42", email: "m.silva@acme.test" }],
        openThrows: Object.assign(new Error("conflicting key value"), {
          code: "23P01",
        }),
      });

      await expect(
        service.linkProvenMatches({ organizationId }),
      ).resolves.toEqual({ linked: 0, suspended: 0, unproven: 0 });
    });

    it("still raises anything that is not the overlap rule", async () => {
      const { service } = build({
        people: [person()],
        emails: [{ userId: "user_42", email: "m.silva@acme.test" }],
        openThrows: new Error("the database is on fire"),
      });

      await expect(
        service.linkProvenMatches({ organizationId }),
      ).rejects.toThrow("the database is on fire");
    });
  });
});

describe("Feature: turning a suggestion into a link", () => {
  const suggestion = {
    id: "ims_1",
    discoveredPersonId: "dp_1",
    userId: "user_42",
  };

  describe("given a stored suggestion for a person with no link", () => {
    it("opens the link on the person's say-so, not on the score", async () => {
      const { service, opened, deletedForPerson } = build({
        suggestions: [suggestion],
      });

      await expect(
        service.confirmSuggestion({ organizationId, suggestionId: "ims_1" }),
      ).resolves.toEqual({ discoveredPersonId: "dp_1", userId: "user_42" });

      expect(opened).toEqual([
        {
          discoveredPersonId: "dp_1",
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.HUMAN_CONFIRMED,
          validFrom: at,
        },
      ]);
      // Every candidate for that person, not only the confirmed row: they hold
      // a link now, so the rest are decisions nobody will make.
      expect(deletedForPerson).toEqual(["dp_1"]);
    });
  });

  describe("given a suggestion that has already been confirmed", () => {
    /** @scenario "Confirming a suggestion that no longer exists is refused" */
    it("refuses, naming the suggestion rather than failing anonymously", async () => {
      const { service } = build({ suggestions: [] });

      await expect(
        service.confirmSuggestion({ organizationId, suggestionId: "ims_1" }),
      ).rejects.toBeInstanceOf(IdentityMatchSuggestionNotFoundError);
    });
  });

  describe("given two reviewers confirming at the same instant", () => {
    it("tells the loser the person is already linked, not that something unknown happened", async () => {
      // Both reads pass; the exclusion constraint refuses the second write. The
      // check and the constraint hold one rule between them, so they say one
      // sentence.
      const { service } = build({
        suggestions: [suggestion],
        openThrows: Object.assign(new Error("conflicting key value"), {
          code: "23P01",
        }),
      });

      await expect(
        service.confirmSuggestion({ organizationId, suggestionId: "ims_1" }),
      ).rejects.toBeInstanceOf(IdentityAlreadyLinkedError);
    });
  });
});

describe("Feature: reading the review queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands back what the job stored, without scoring anything itself", async () => {
    const stored = [
      { id: "ims_1", discoveredPersonId: "dp_1", userId: "user_42" },
    ];
    const { service } = build({ suggestions: stored });

    await expect(service.listSuggestions({ organizationId })).resolves.toEqual(
      stored,
    );
  });
});
