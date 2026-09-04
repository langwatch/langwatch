// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The suggestion job: what it puts in front of a person, and — more to the
 * point — what it never does, which is open a link.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";

import {
  IdentityMatchSuggestionService,
  MAX_SUGGESTIONS_PER_PERSON,
} from "../identityMatchSuggestion.service";

const organizationId = "org_acme";
const computedAt = new Date("2026-09-03T05:41:00.000Z");

type Person = { id: string; displayText: string };

const build = ({
  people = [],
  openLinks = [],
  members = [],
}: {
  people?: Person[];
  openLinks?: { discoveredPersonId: string; userId: string | null }[];
  members?: { userId: string; name: string }[];
} = {}) => {
  let written: {
    discoveredPersonId: string;
    userId: string;
    score: number;
  }[] = [];

  const suggestions = {
    replaceForOrganization: vi.fn(
      async (
        _client: unknown,
        params: {
          suggestions: {
            discoveredPersonId: string;
            userId: string;
            score: number;
          }[];
        },
      ) => {
        const removed = written.length;
        written = params.suggestions;
        return { removed, written: params.suggestions.length };
      },
    ),
  };

  const service = new IdentityMatchSuggestionService({
    prisma: {} as PrismaClient,
    discoveredPeople: {
      findMatchable: vi.fn().mockResolvedValue(people),
    } as never,
    matches: {
      findOpenByOrganization: vi.fn().mockResolvedValue(openLinks),
    } as never,
    suggestions: suggestions as never,
    accounts: {
      findMemberNames: vi.fn().mockResolvedValue(members),
    } as never,
    now: () => computedAt,
  });

  return { service, suggestions, read: () => written };
};

describe("Feature: computing who a provider-named person might be", () => {
  describe("given a display text that resembles a member's name", () => {
    /** @scenario "A name that merely resembles an account becomes a suggestion, never a link" */
    it("stores it as a question for a person, and opens no link", async () => {
      const { service, read } = build({
        people: [{ id: "dp_1", displayText: "m.silva" }],
        members: [{ userId: "user_42", name: "Maria Silva" }],
      });

      const outcome = await service.recompute({ organizationId });

      expect(read()).toEqual([
        {
          discoveredPersonId: "dp_1",
          userId: "user_42",
          score: expect.any(Number),
        },
      ]);
      expect(outcome.suggestionsWritten).toBe(1);
      // The service has no way to open a link at all — it holds no repository
      // that can. That is the boundary, not a rule it remembers to follow.
      expect(service).not.toHaveProperty("open");
    });
  });

  describe("given a member whose name shares no word with the display text", () => {
    it("never reaches the comparison, which is what keeps the pass affordable", async () => {
      const { service } = build({
        people: [{ id: "dp_1", displayText: "Maria Silva" }],
        members: [{ userId: "user_42", name: "Jonas Bakker" }],
      });

      const outcome = await service.recompute({ organizationId });

      expect(outcome.pairsScored).toBe(0);
      expect(outcome.suggestionsWritten).toBe(0);
    });
  });

  describe("given a resemblance too weak to be worth a decision", () => {
    it("scores the pair and then stores nothing", async () => {
      const { service } = build({
        people: [{ id: "dp_1", displayText: "Silva Jonas" }],
        members: [{ userId: "user_42", name: "Silva Bakker" }],
      });

      const outcome = await service.recompute({ organizationId });

      // Scored — so the prefilter admitted it — and still not stored. The two
      // numbers together are what say which gate did the work.
      expect(outcome.pairsScored).toBe(1);
      expect(outcome.suggestionsWritten).toBe(0);
    });
  });

  describe("given a person who already holds an open link", () => {
    it("skips them before scoring, since the answer would be discarded anyway", async () => {
      const { service } = build({
        people: [{ id: "dp_1", displayText: "m.silva" }],
        openLinks: [{ discoveredPersonId: "dp_1", userId: "user_42" }],
        members: [{ userId: "user_42", name: "Maria Silva" }],
      });

      const outcome = await service.recompute({ organizationId });

      expect(outcome.peopleConsidered).toBe(0);
      expect(outcome.pairsScored).toBe(0);
    });
  });

  describe("given a name that resembles many colleagues", () => {
    it("keeps only the strongest few, so the queue stays something a person finishes", async () => {
      const members = Array.from({ length: 9 }, (_, index) => ({
        userId: `user_${index}`,
        // All within the length band, all sharing "silva", all near enough to
        // clear the bar — the pathological case a cap exists for.
        name: `Maria Silva${"a".repeat(index)}`,
      }));
      const { service, read } = build({
        people: [{ id: "dp_1", displayText: "Maria Silva" }],
        members,
      });

      await service.recompute({ organizationId });

      expect(read().length).toBeLessThanOrEqual(MAX_SUGGESTIONS_PER_PERSON);
      // Strongest first, so the cap keeps the best rather than the first found.
      const scores = read().map((row) => row.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    });
  });

  describe("given stored suggestions from an earlier run", () => {
    it("replaces them with what the new inputs imply", async () => {
      const { service, suggestions } = build({
        people: [{ id: "dp_1", displayText: "m.silva" }],
        members: [{ userId: "user_42", name: "Maria Silva" }],
      });

      await service.recompute({ organizationId });
      await service.recompute({ organizationId });

      // Both passes go through the wholesale swap rather than adding to what
      // is there: a row the new inputs no longer imply is a decision that no
      // longer means anything.
      expect(suggestions.replaceForOrganization).toHaveBeenCalledTimes(2);
      const second = suggestions.replaceForOrganization.mock.calls[1]?.[1];
      expect(second).toMatchObject({ organizationId, computedAt });
    });
  });
});
