// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The match engine against real Postgres.
 *
 * What lives here rather than in the unit tests is everything that is a WHERE
 * clause or a constraint: which people the engine is allowed to touch, that a
 * halt survives the next pass because the read skips it, and that confirming a
 * suggestion opens a link the database will not let anybody open twice. An
 * application-level double would pass all of that while the filter was absent.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

import { IdentityAlreadyLinkedError } from "../identityMatch.errors";
import { IdentityMatchService } from "../identityMatch.service";
import { IdentityMatchSuggestionService } from "../identityMatchSuggestion.service";

const ns = nanoid(8);

/**
 * Ids minted here rather than read back off the rows, so every one of them is a
 * module-level `const`.
 *
 * A `let` assigned inside `beforeAll` is `undefined` whenever setup threw
 * first, Prisma drops an undefined field from a where clause, and the cleanup
 * that was meant to remove this test's rows removes the table's (#6219).
 */
const organizationId = `org_match_${ns}`;
const mariaUserId = `user_maria_${ns}`;
const jonasUserId = `user_jonas_${ns}`;

const at = new Date("2026-09-03T05:41:00.000Z");
const seenAt = new Date("2026-08-01T00:00:00.000Z");

const matcher = () => new IdentityMatchService({ prisma, now: () => at });
const suggester = () =>
  new IdentityMatchSuggestionService({ prisma, now: () => at });

/** A discovered person, with only the fields a test ever varies spelled out. */
const seedPerson = async (person: {
  id: string;
  rawActorId: string;
  displayText: string;
  kind?: string;
  suspendedAt?: Date | null;
  suspendedReason?: string | null;
  erasedAt?: Date | null;
}) =>
  await prisma.discoveredPerson.create({
    data: {
      id: `${person.id}_${ns}`,
      organizationId,
      provider: "openai_admin",
      rawActorId: person.rawActorId,
      displayText: person.displayText,
      kind: person.kind ?? "person",
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      suspendedAt: person.suspendedAt ?? null,
      suspendedReason: person.suspendedReason ?? null,
      erasedAt: person.erasedAt ?? null,
    },
  });

const linksFor = (discoveredPersonId: string) =>
  prisma.identityMatch.findMany({
    where: { organizationId, discoveredPersonId },
    orderBy: { validFrom: "asc" },
  });

describe("Feature: the match engine, against the database that holds its rules", () => {
  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Match Org",
        slug: `--test-match-${ns}`,
      },
    });

    const member = async (
      id: string,
      name: string,
      email: string,
      verified: boolean,
    ) => {
      await prisma.user.create({
        data: { id, name, email, emailVerified: verified },
      });
      await prisma.organizationUser.create({
        data: { organizationId, userId: id, role: "MEMBER" },
      });
    };

    await member(mariaUserId, "Maria Silva", `m.silva-${ns}@acme.test`, true);
    await member(
      jonasUserId,
      "Jonas Bakker",
      `j.bakker-${ns}@acme.test`,
      false,
    );
  });

  // Through the same helper as the teardown: these ids are `const`, so the
  // collapse #6219 describes cannot happen here either — and a per-test reset
  // that removes more than it meant to is the same bug wearing a different hat.
  beforeEach(() =>
    cleanupTestRows(prisma, [
      ["identityMatchSuggestion", { organizationId }],
      ["identityMatch", { organizationId }],
      ["discoveredPerson", { organizationId }],
    ]),
  );

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["identityMatchSuggestion", { organizationId }],
      ["identityMatch", { organizationId }],
      ["discoveredPerson", { organizationId }],
      ["organizationUser", { organizationId }],
      ["user", { id: { in: [mariaUserId, jonasUserId] } }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given a person whose address a member has confirmed", () => {
    it("opens exactly one link, and a second pass adds nothing", async () => {
      const person = await seedPerson({
        id: "dp_maria",
        rawActorId: `m.silva-${ns}@acme.test`,
        displayText: `m.silva-${ns}@acme.test`,
      });

      await expect(
        matcher().linkProvenMatches({ organizationId }),
      ).resolves.toMatchObject({ linked: 1 });
      // Idempotent, which is what makes it safe to run nightly: the second
      // pass agrees with the link it made and writes nothing.
      await expect(
        matcher().linkProvenMatches({ organizationId }),
      ).resolves.toMatchObject({ linked: 0, suspended: 0 });

      const links = await linksFor(person.id);
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({
        userId: mariaUserId,
        evidenceKind: "verified_email",
        validTo: null,
      });
    });
  });

  describe("given a member who has never confirmed their address", () => {
    /** @scenario "An address nobody has confirmed proves nothing" */
    it("links nobody, because the read never offers an unconfirmed address", async () => {
      const person = await seedPerson({
        id: "dp_jonas",
        rawActorId: `j.bakker-${ns}@acme.test`,
        displayText: `j.bakker-${ns}@acme.test`,
      });

      await expect(
        matcher().linkProvenMatches({ organizationId }),
      ).resolves.toMatchObject({ linked: 0, unproven: 1 });
      await expect(linksFor(person.id)).resolves.toEqual([]);
    });
  });

  describe("given a machine login whose identifier is a member's address", () => {
    /** @scenario "Somebody who is not a person is never linked to an account" */
    it("is never linked, so plumbing traffic stays out of an employee's spend", async () => {
      const person = await seedPerson({
        id: "dp_machine",
        rawActorId: `m.silva-${ns}@acme.test`,
        displayText: `m.silva-${ns}@acme.test`,
        kind: "service_account",
      });

      await expect(
        matcher().linkProvenMatches({ organizationId }),
      ).resolves.toEqual({ linked: 0, suspended: 0, unproven: 0 });
      await expect(linksFor(person.id)).resolves.toEqual([]);
    });
  });

  describe("given a person whose automatic linking was halted", () => {
    /** @scenario "A halt survives the next run of the matcher" */
    it("is skipped by the read, and the halt is left exactly as it was", async () => {
      const haltedAt = new Date("2026-07-01T00:00:00.000Z");
      const person = await seedPerson({
        id: "dp_halted",
        rawActorId: `m.silva-${ns}@acme.test`,
        displayText: `m.silva-${ns}@acme.test`,
        suspendedAt: haltedAt,
        suspendedReason: "ambiguous_verified_email",
      });

      await matcher().linkProvenMatches({ organizationId });

      await expect(linksFor(person.id)).resolves.toEqual([]);
      const after = await prisma.discoveredPerson.findFirstOrThrow({
        where: { id: person.id, organizationId },
      });
      // Not re-stamped: `suspendedAt` is the instant of the FIRST
      // contradiction, and a reviewer asking how long this has been stuck
      // needs it to stay that.
      expect(after.suspendedAt).toEqual(haltedAt);
      expect(after.suspendedReason).toBe("ambiguous_verified_email");
    });

    /** @scenario "A person whose automatic linking is halted gets no suggestions either" */
    it("gets no suggestions either, since guesses on top of contradictions are not help", async () => {
      await seedPerson({
        id: "dp_halted_sugg",
        rawActorId: "user_opaque",
        displayText: "m.silva",
        suspendedAt: new Date("2026-07-01T00:00:00.000Z"),
        suspendedReason: "ambiguous_verified_email",
      });

      await expect(
        suggester().recompute({ organizationId }),
      ).resolves.toMatchObject({ peopleConsidered: 0, suggestionsWritten: 0 });
    });
  });

  describe("given a person who has been erased", () => {
    /** @scenario "An erased person is never linked to an account again" */
    it("is never matched again, so an erasure cannot be undone by a nightly pass", async () => {
      const person = await seedPerson({
        id: "dp_erased",
        // An erasure leaves a stand-in here, but the guarantee must not rest on
        // a digest happening not to parse as an address: this seeds the address
        // itself, so only the `erasedAt` filter can keep the link from opening.
        rawActorId: `m.silva-${ns}@acme.test`,
        displayText: `m.silva-${ns}@acme.test`,
        erasedAt: new Date("2026-08-15T00:00:00.000Z"),
      });

      await matcher().linkProvenMatches({ organizationId });

      await expect(linksFor(person.id)).resolves.toEqual([]);
    });
  });

  describe("given a display text that resembles a member's name", () => {
    it("stores a suggestion and opens no link", async () => {
      const person = await seedPerson({
        id: "dp_resembles",
        rawActorId: "user_opaque",
        displayText: "m.silva",
      });

      await matcher().linkProvenMatches({ organizationId });
      await suggester().recompute({ organizationId });

      await expect(linksFor(person.id)).resolves.toEqual([]);
      const stored = await prisma.identityMatchSuggestion.findMany({
        where: { organizationId },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        discoveredPersonId: person.id,
        userId: mariaUserId,
      });
    });
  });

  describe("given stored suggestions from an earlier run", () => {
    /** @scenario "Running the suggestion job again replaces what it found last time" */
    it("keeps what the new inputs imply and drops what they do not", async () => {
      const stale = await seedPerson({
        id: "dp_stale",
        rawActorId: "user_stale",
        displayText: "m.silva",
      });
      await suggester().recompute({ organizationId });
      await expect(
        prisma.identityMatchSuggestion.count({ where: { organizationId } }),
      ).resolves.toBe(1);

      // The input changes: this person is now linked, so every candidate for
      // them is a decision nobody will make.
      await prisma.identityMatch.create({
        data: {
          organizationId,
          discoveredPersonId: stale.id,
          userId: jonasUserId,
          evidenceKind: "human_confirmed",
          validFrom: at,
        },
      });

      await expect(
        suggester().recompute({ organizationId }),
      ).resolves.toMatchObject({
        suggestionsRemoved: 1,
        suggestionsWritten: 0,
      });
      await expect(
        prisma.identityMatchSuggestion.count({ where: { organizationId } }),
      ).resolves.toBe(0);
    });
  });

  describe("given a stored suggestion for a person", () => {
    /** @scenario "Confirming a suggestion opens the link and clears the suggestion" */
    it("opens the link on the person's say-so and empties their queue", async () => {
      const person = await seedPerson({
        id: "dp_confirm",
        rawActorId: "user_confirm",
        displayText: "m.silva",
      });
      await suggester().recompute({ organizationId });
      const suggestion = await prisma.identityMatchSuggestion.findFirstOrThrow({
        where: { organizationId, discoveredPersonId: person.id },
      });

      await expect(
        matcher().confirmSuggestion({
          organizationId,
          suggestionId: suggestion.id,
        }),
      ).resolves.toEqual({
        discoveredPersonId: person.id,
        userId: mariaUserId,
      });

      const links = await linksFor(person.id);
      expect(links).toHaveLength(1);
      // The score is why we asked, not why the link is true.
      expect(links[0]).toMatchObject({
        userId: mariaUserId,
        evidenceKind: "human_confirmed",
        validTo: null,
      });
      await expect(
        prisma.identityMatchSuggestion.count({
          where: { organizationId, discoveredPersonId: person.id },
        }),
      ).resolves.toBe(0);
    });
  });

  describe("given a stored suggestion for a person who has since been linked", () => {
    /** @scenario "Confirming a suggestion for somebody since linked is refused" */
    it("refuses, and says the person already holds a link", async () => {
      const person = await seedPerson({
        id: "dp_raced",
        rawActorId: "user_raced",
        displayText: "m.silva",
      });
      await suggester().recompute({ organizationId });
      const suggestion = await prisma.identityMatchSuggestion.findFirstOrThrow({
        where: { organizationId, discoveredPersonId: person.id },
      });

      await prisma.identityMatch.create({
        data: {
          organizationId,
          discoveredPersonId: person.id,
          userId: jonasUserId,
          evidenceKind: "human_confirmed",
          validFrom: at,
        },
      });

      await expect(
        matcher().confirmSuggestion({
          organizationId,
          suggestionId: suggestion.id,
        }),
      ).rejects.toBeInstanceOf(IdentityAlreadyLinkedError);
      // And the link that was already there is untouched.
      await expect(linksFor(person.id)).resolves.toHaveLength(1);
    });
  });

  describe("given a suggestion belonging to another organization", () => {
    it("cannot be confirmed from this one", async () => {
      const person = await seedPerson({
        id: "dp_other",
        rawActorId: "user_other",
        displayText: "m.silva",
      });
      await suggester().recompute({ organizationId });
      const suggestion = await prisma.identityMatchSuggestion.findFirstOrThrow({
        where: { organizationId, discoveredPersonId: person.id },
      });

      await expect(
        matcher().confirmSuggestion({
          organizationId: `org_someone_else_${ns}`,
          suggestionId: suggestion.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe("given a score the job would never produce", () => {
    it("is refused by the database, so a bad score cannot sort itself to the top", async () => {
      await expect(
        prisma.identityMatchSuggestion.create({
          data: {
            organizationId,
            discoveredPersonId: `dp_bogus_${ns}`,
            userId: mariaUserId,
            score: 1.5,
            computedAt: at,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
