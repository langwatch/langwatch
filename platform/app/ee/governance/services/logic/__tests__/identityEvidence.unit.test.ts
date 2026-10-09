// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The evidence rules, in isolation. This is the file where "we linked the wrong
 * two people" would happen, so every branch gets a case naming the situation it
 * is about rather than the shape of the input.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { describe, expect, it } from "vitest";

import {
  decideMatch,
  MATCH_EVIDENCE_KIND,
  MATCH_SUSPENSION_REASON,
  normalizeEmail,
} from "../identityEvidence";

const accounts = ({
  emails = {},
  directoryIds = {},
}: {
  emails?: Record<string, string[]>;
  directoryIds?: Record<string, string[]>;
} = {}) => ({
  usersByVerifiedEmail: new Map(Object.entries(emails)),
  usersByDirectoryId: new Map(Object.entries(directoryIds)),
});

describe("Feature: deciding which account a provider-named person is", () => {
  describe("given a person whose identifier is an email address", () => {
    describe("when an account in the organization has confirmed that address", () => {
      /** @scenario "An address that matches a confirmed account links without anybody clicking" */
      it("links them, recording the confirmed address as the proof", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "m.silva@acme.test",
            displayText: "m.silva@acme.test",
          },
          accounts: accounts({ emails: { "m.silva@acme.test": ["user_42"] } }),
        });

        expect(decision).toEqual({
          outcome: "link",
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.VERIFIED_EMAIL,
        });
      });

      it("matches across a difference in case, which providers disagree about", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "M.Silva@Acme.test",
            displayText: "Maria Silva",
          },
          accounts: accounts({ emails: { "m.silva@acme.test": ["user_42"] } }),
        });

        expect(decision).toMatchObject({ outcome: "link", userId: "user_42" });
      });

      it("reads the address out of whichever of the two fields carries it", () => {
        // OpenAI puts the address in one field and an opaque id in the other;
        // Databricks puts it in the id field itself. Trying only the field we
        // expected would silently match nobody for one of the two.
        const decision = decideMatch({
          identity: {
            rawActorId: "user_abc123",
            displayText: "m.silva@acme.test",
          },
          accounts: accounts({ emails: { "m.silva@acme.test": ["user_42"] } }),
        });

        expect(decision).toMatchObject({ outcome: "link", userId: "user_42" });
      });
    });

    describe("when the account holding that address has never confirmed it", () => {
      /** @scenario "An address nobody has confirmed proves nothing" */
      it("proves nothing, because an unconfirmed address is a claim anyone can type", () => {
        // Unconfirmed addresses never reach the index — that is the caller's
        // half of the rule, and this asserts the consequence: an empty index
        // links nobody rather than falling back to something weaker.
        const decision = decideMatch({
          identity: {
            rawActorId: "m.silva@acme.test",
            displayText: "m.silva@acme.test",
          },
          accounts: accounts(),
        });

        expect(decision).toEqual({ outcome: "no_action" });
      });
    });

    describe("when two accounts have both confirmed that address", () => {
      /** @scenario "An address that two accounts both confirmed stops automatic linking" */
      it("halts automatic linking and names both accounts for the reviewer", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "shared@acme.test",
            displayText: "shared@acme.test",
          },
          accounts: accounts({
            emails: { "shared@acme.test": ["user_42", "user_77"] },
          }),
        });

        expect(decision).toEqual({
          outcome: "suspend",
          reason: MATCH_SUSPENSION_REASON.AMBIGUOUS_EMAIL,
          candidateUserIds: ["user_42", "user_77"],
        });
      });
    });
  });

  describe("given a person whose identifier is a directory identifier", () => {
    describe("when an account carries that same identifier and nothing else agrees", () => {
      /** @scenario "A directory identifier on its own never links anybody" */
      it("links nobody, because a directory identifier never stands alone", () => {
        const decision = decideMatch({
          identity: { rawActorId: "ext-991", displayText: "ext-991" },
          accounts: accounts({ directoryIds: { "ext-991": ["user_42"] } }),
        });

        expect(decision).toEqual({ outcome: "no_action" });
      });
    });

    describe("when two accounts carry that same identifier", () => {
      it("still links nobody, and does not halt over evidence it would not act on", () => {
        // A halt costs a human a review. Raising one about evidence that could
        // never have linked anybody is a review with no decision in it.
        const decision = decideMatch({
          identity: { rawActorId: "ext-991", displayText: "ext-991" },
          accounts: accounts({
            directoryIds: { "ext-991": ["user_42", "user_77"] },
          }),
        });

        expect(decision).toEqual({ outcome: "no_action" });
      });
    });
  });

  describe("given a person whose address matches a confirmed account", () => {
    describe("when that same account carries the directory identifier too", () => {
      /** @scenario "A directory identifier agreeing with the address is recorded as the stronger proof" */
      it("links them, and the row says the directory agreed as well", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "ext-991",
            displayText: "m.silva@acme.test",
          },
          accounts: accounts({
            emails: { "m.silva@acme.test": ["user_42"] },
            directoryIds: { "ext-991": ["user_42"] },
          }),
        });

        expect(decision).toEqual({
          outcome: "link",
          userId: "user_42",
          evidenceKind: MATCH_EVIDENCE_KIND.VERIFIED_EMAIL_AND_DIRECTORY_ID,
        });
      });
    });

    describe("when the directory identifier belongs to a different account", () => {
      /** @scenario "A directory identifier naming a different account than the address stops automatic linking" */
      it("halts, because one of the two is stale and nothing here can tell which", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "ext-991",
            displayText: "m.silva@acme.test",
          },
          accounts: accounts({
            emails: { "m.silva@acme.test": ["user_42"] },
            directoryIds: { "ext-991": ["user_77"] },
          }),
        });

        expect(decision).toEqual({
          outcome: "suspend",
          reason: MATCH_SUSPENSION_REASON.DIRECTORY_DISAGREES,
          candidateUserIds: ["user_42", "user_77"],
        });
      });
    });
  });

  describe("given a person who already holds an open link", () => {
    describe("when the evidence still names the account the link names", () => {
      it("does nothing, because agreeing with what is there is not a write", () => {
        const decision = decideMatch({
          identity: {
            rawActorId: "m.silva@acme.test",
            displayText: "m.silva@acme.test",
            openLinkUserId: "user_42",
          },
          accounts: accounts({ emails: { "m.silva@acme.test": ["user_42"] } }),
        });

        expect(decision).toEqual({ outcome: "no_action" });
      });
    });

    describe("when the evidence now names a different account", () => {
      it("halts rather than re-pointing the link", () => {
        // Silently re-pointing is how one person's spend lands under another
        // person's name with nothing anywhere saying it moved.
        const decision = decideMatch({
          identity: {
            rawActorId: "m.silva@acme.test",
            displayText: "m.silva@acme.test",
            openLinkUserId: "user_old",
          },
          accounts: accounts({ emails: { "m.silva@acme.test": ["user_42"] } }),
        });

        expect(decision).toEqual({
          outcome: "suspend",
          reason: MATCH_SUSPENSION_REASON.CONTRADICTS_OPEN_LINK,
          candidateUserIds: ["user_old", "user_42"],
        });
      });
    });
  });
});

describe("Feature: reading an address out of what a provider sent", () => {
  it("accepts an ordinary address, lowercased and trimmed", () => {
    expect(normalizeEmail("  M.Silva@Acme.test ")).toBe("m.silva@acme.test");
  });

  it.each([
    ["a bare name", "maria"],
    ["a display form carrying an address", "Maria Silva <m@acme.test>"],
    ["an opaque provider id", "user_abc123"],
    ["a domain with no dot", "m.silva@localhost"],
    ["two at-signs", "a@b@acme.test"],
    ["an empty string", ""],
  ])("refuses %s, so it cannot manufacture a match", (_case, input) => {
    expect(normalizeEmail(input)).toBeNull();
  });
});
