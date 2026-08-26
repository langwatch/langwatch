import { describe, expect, it } from "vitest";
import type {
  IdentifierFact,
  IdentityFact,
  IdentityHeads,
} from "../facts";
import { emptyIdentityHeads } from "../facts";
import {
  type IdentifierHead,
  identityStreamsFor,
  primaryChangeFacts,
  reduceIdentifier,
  userErasureFacts,
} from "../identifier-aggregate";
import { reduceIdentity } from "../reduce";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

function attached(
  identifierId: string,
  overrides?: Partial<
    Extract<IdentityFact, { type: "lw.identity.identifier_attached" }>["data"]
  > & { occurredAt?: number },
): IdentityFact {
  const { occurredAt, ...data } = overrides ?? {};
  return {
    type: "lw.identity.identifier_attached",
    occurredAt: occurredAt ?? T0,
    data: {
      identifierId,
      userId: USER,
      accountId: null,
      provider: "email",
      providerId: null,
      issuer: null,
      providerAccountId: null,
      value: "sam@acme.com",
      identifierHash: "hmac:abc",
      domain: "acme.com",
      connectionId: null,
      state: "ATTACHED",
      actor: ACTOR,
      ...data,
    },
  };
}

function verified(identifierId: string, occurredAt = T0 + 1): IdentityFact {
  return {
    type: "lw.identity.identifier_verified",
    occurredAt,
    data: {
      identifierId,
      verificationId: null,
      method: "creation",
      actor: ACTOR,
    },
  };
}

function primaryChanged({
  identifierId,
  previousIdentifierId = null,
  occurredAt = T0 + 2,
}: {
  identifierId: string;
  previousIdentifierId?: string | null;
  occurredAt?: number;
}): IdentityFact {
  return {
    type: "lw.identity.primary_changed",
    occurredAt,
    data: { identifierId, previousIdentifierId, actor: ACTOR },
  };
}

function detached(identifierId: string, occurredAt = T0 + 3): IdentityFact {
  return {
    type: "lw.identity.identifier_detached",
    occurredAt,
    data: { identifierId, actor: ACTOR },
  };
}

function erased(erasedIdentifierIds: string[]): IdentityFact {
  return {
    type: "lw.identity.user_erased",
    occurredAt: T0 + 4,
    data: {
      userId: USER,
      erasedIdentifierIds,
      actor: { type: "system", id: "ops:erasure-request" },
    },
  };
}

function proposed(): IdentityFact {
  return {
    type: "lw.identity.link_proposed",
    occurredAt: T0 + 5,
    data: {
      proposalId: "prop_1",
      userId: USER,
      connectionId: null,
      provider: "oidc",
      providerAccountId: "sub_1",
      value: "sam@acme.com",
      domain: "acme.com",
      reason: "ambiguous_candidates",
      actor: ACTOR,
    },
  };
}

function deadEnded(identifierId: string, occurredAt = T0 + 6): IdentityFact {
  return {
    type: "lw.identity.identifier_dead_ended",
    occurredAt,
    data: { identifierId, reason: "verification_failed", actor: ACTOR },
  };
}

/** The identifier streams one fact is routed to. */
function identifierStreamIds(fact: IdentityFact): string[] {
  return identityStreamsFor({ fact, userId: USER })
    .filter((stream) => stream.kind === "identifier")
    .map((stream) => stream.identifierId);
}

/** The whole history of one stream, folded the way its own aggregate would. */
function foldStream(
  identifierId: string,
  facts: IdentityFact[],
): IdentifierHead {
  return facts
    .filter((fact) => identifierStreamIds(fact).includes(identifierId))
    .reduce<IdentifierHead>(
      (head, fact) => reduceIdentifier({ identifierId, head, fact }),
      null,
    );
}

/** One head, in whatever state a case needs it. */
function headIn(state: IdentifierFact["state"]): IdentifierFact {
  const head = foldUser([attached("idf_work")]).identifiers.idf_work;
  if (!head) throw new Error("the fixture attach produced no head");
  return { ...head, state };
}

function foldUser(facts: IdentityFact[]): IdentityHeads {
  return facts.reduce(
    (heads, fact) => reduceIdentity({ heads, fact }),
    emptyIdentityHeads({ userId: USER }),
  );
}

describe("identityStreamsFor", () => {
  describe("when a fact is about one identifier", () => {
    /** @scenario "An identifier's own facts route to its own stream" */
    it("routes it to that identifier and to nothing else", () => {
      const facts = [
        attached("idf_work"),
        verified("idf_work"),
        detached("idf_work"),
        {
          type: "lw.identity.identifier_dead_ended",
          occurredAt: T0,
          data: {
            identifierId: "idf_work",
            reason: "verification_failed",
            actor: ACTOR,
          },
        } satisfies IdentityFact,
      ];
      for (const fact of facts) {
        expect(identityStreamsFor({ fact, userId: USER })).toEqual([
          { kind: "identifier", identifierId: "idf_work" },
        ]);
      }
    });
  });

  describe("when a promotion demotes a standing PRIMARY", () => {
    /** @scenario "A promotion routes a demotion to the identifier losing PRIMARY" */
    it("routes the fact to the promoted stream and the demoted one", () => {
      const fact = primaryChanged({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
      expect(identifierStreamIds(fact)).toEqual(["idf_work", "idf_personal"]);
    });
  });

  describe("when nothing was demoted", () => {
    /** @scenario "A first primary change routes one stream only" */
    it("routes the promotion to one stream", () => {
      const fact = primaryChanged({ identifierId: "idf_work" });
      expect(identifierStreamIds(fact)).toEqual(["idf_work"]);
    });
  });

  describe("when the fact is about the person", () => {
    /** @scenario "A proposal names no identifier, so it stays on the person's stream" */
    it("routes a link proposal to the person's stream alone", () => {
      expect(identityStreamsFor({ fact: proposed(), userId: USER })).toEqual([
        { kind: "person", userId: USER },
      ]);
    });

    /** @scenario "An erasure is routed to every identifier it names, and to the person" */
    it("routes an erasure to the person first, then to each identifier", () => {
      const fact = erased(["idf_work", "idf_personal"]);
      expect(identityStreamsFor({ fact, userId: USER })).toEqual([
        { kind: "person", userId: USER },
        { kind: "identifier", identifierId: "idf_work" },
        { kind: "identifier", identifierId: "idf_personal" },
      ]);
    });
  });

  describe("when any fact is routed", () => {
    /** @scenario "A stream says which kind it is" */
    it("says of each stream whether it is an identifier or the person", () => {
      // Both are prefixed KSUIDs, so the shape of the answer is the only thing
      // that stops a per-identifier fold being handed a person's stream.
      const kinds = [
        attached("idf_work"),
        verified("idf_work"),
        primaryChanged({ identifierId: "idf_work" }),
        erased(["idf_work"]),
        proposed(),
      ].flatMap((fact) =>
        identityStreamsFor({ fact, userId: USER }).map((stream) => stream.kind),
      );
      expect(kinds).toEqual([
        "identifier",
        "identifier",
        "identifier",
        "person",
        "identifier",
        "person",
      ]);
    });

    it("names a stream once, however often the fact repeats it", () => {
      // A shape no command states: `primaryChangeFacts` excludes the identifier
      // being promoted. A malformed legacy fact would otherwise be appended
      // twice onto one stream.
      const fact = primaryChanged({
        identifierId: "idf_work",
        previousIdentifierId: "idf_work",
      });
      expect(identifierStreamIds(fact)).toEqual(["idf_work"]);
    });
  });
});

describe("reduceIdentifier", () => {
  describe("when a stream folds its own facts", () => {
    /** @scenario "Folding one identifier's stream never reads another identifier" */
    it("reaches the state its own stream implies", () => {
      const head = foldStream("idf_work", [
        attached("idf_work"),
        attached("idf_personal", { value: "sam@personal.dev" }),
        verified("idf_work"),
        verified("idf_personal"),
      ]);
      expect(head?.state).toBe("VERIFIED");
      expect(head?.value).toBe("sam@acme.com");
    });

    /** @scenario "A verify for a head that does not exist yet folds to nothing" */
    it("folds a verify for an absent head to nothing", () => {
      expect(
        reduceIdentifier({
          identifierId: "idf_work",
          head: null,
          fact: verified("idf_work"),
        }),
      ).toBeNull();
    });

    /** @scenario "Re-applying an attach never regresses the head" */
    it("keeps the later state when the attach is folded again", () => {
      const head = foldStream("idf_work", [
        attached("idf_work"),
        verified("idf_work"),
        attached("idf_work"),
      ]);
      expect(head?.state).toBe("VERIFIED");
    });

    /** @scenario "A tombstone never resurrects on its own stream" */
    it("keeps a detached head detached", () => {
      const head = foldStream("idf_work", [
        attached("idf_work"),
        detached("idf_work"),
        verified("idf_work", T0 + 9),
      ]);
      expect(head?.state).toBe("DETACHED");
      expect(head?.value).toBe("sam@acme.com");
    });
  });

  describe("when a dead end is folded", () => {
    /** @scenario "A dead end takes an attached identifier out of use" */
    it("takes an ATTACHED head out of use and leaves any other state alone", () => {
      const attachedHead = headIn("ATTACHED");
      expect(
        reduceIdentifier({
          identifierId: "idf_work",
          head: attachedHead,
          fact: deadEnded("idf_work"),
        })?.state,
      ).toBe("DEAD_END");
      for (const state of ["VERIFIED", "PRIMARY", "DETACHED", "DEAD_END"] as const) {
        const head = headIn(state);
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head,
            fact: deadEnded("idf_work"),
          }),
        ).toBe(head);
      }
    });
  });

  describe("when a promotion names a head that cannot take PRIMARY", () => {
    /** @scenario "A promotion of a head that cannot take PRIMARY moves nothing" */
    it("returns the head exactly as it was", () => {
      for (const state of ["ATTACHED", "DEAD_END", "DETACHED"] as const) {
        const head = headIn(state);
        expect(
          reduceIdentifier({
            identifierId: "idf_work",
            head,
            fact: primaryChanged({ identifierId: "idf_work" }),
          }),
        ).toBe(head);
      }
    });
  });

  describe("when a fact naming another identifier reaches this head", () => {
    /** @scenario "A lifecycle fact naming another identifier is ignored by this head" */
    it("returns the head exactly as it was, without relying on the routing", () => {
      const head = headIn("VERIFIED");
      const foreign = [
        attached("idf_personal"),
        verified("idf_personal"),
        deadEnded("idf_personal"),
        detached("idf_personal"),
      ];
      for (const fact of foreign) {
        expect(reduceIdentifier({ identifierId: "idf_work", head, fact })).toBe(
          head,
        );
      }
    });

    it("creates no head from an attach that names somebody else", () => {
      expect(
        reduceIdentifier({
          identifierId: "idf_work",
          head: null,
          fact: attached("idf_personal"),
        }),
      ).toBeNull();
    });
  });

  describe("when a link proposal is folded against a head", () => {
    /** @scenario "A proposal moves no head, on whichever stream it is folded" */
    it("returns the head exactly as it was", () => {
      const head = headIn("VERIFIED");
      expect(
        reduceIdentifier({ identifierId: "idf_work", head, fact: proposed() }),
      ).toBe(head);
      expect(
        reduceIdentifier({
          identifierId: "idf_work",
          head: null,
          fact: proposed(),
        }),
      ).toBeNull();
    });
  });

  describe("when a promotion of another identifier arrives", () => {
    /** @scenario "The demoted stream folds a promotion of somebody else into a demotion" */
    it("returns a standing PRIMARY to VERIFIED and moves nothing else", () => {
      const standing = foldStream("idf_personal", [
        attached("idf_personal", { state: "VERIFIED" }),
        primaryChanged({ identifierId: "idf_personal" }),
      ]);
      expect(standing?.state).toBe("PRIMARY");
      const demoted = reduceIdentifier({
        identifierId: "idf_personal",
        head: standing,
        fact: primaryChanged({
          identifierId: "idf_work",
          previousIdentifierId: "idf_personal",
          occurredAt: T0 + 6,
        }),
      });
      expect(demoted?.state).toBe("VERIFIED");
      expect({ ...demoted, state: null }).toEqual({ ...standing, state: null });
    });

    /** @scenario "A head that is not PRIMARY is untouched by somebody else's promotion" */
    it("leaves a head that is not PRIMARY exactly as it was", () => {
      const head = foldStream("idf_personal", [
        attached("idf_personal", { state: "VERIFIED" }),
      ]);
      expect(
        reduceIdentifier({
          identifierId: "idf_personal",
          head,
          fact: primaryChanged({
            identifierId: "idf_work",
            previousIdentifierId: "idf_personal",
          }),
        }),
      ).toBe(head);
    });
  });

  describe("when the stream folds an erasure", () => {
    /** @scenario "An erased stream keeps its row, its domain and its dates" */
    it("wipes the value and the hash and keeps everything else", () => {
      const before = foldStream("idf_work", [
        attached("idf_work", { state: "VERIFIED" }),
      ]);
      const after = reduceIdentifier({
        identifierId: "idf_work",
        head: before,
        fact: erased(["idf_work"]),
      });
      expect(after?.value).toBeNull();
      expect(after?.identifierHash).toBeNull();
      expect(after?.domain).toBe("acme.com");
      expect(after?.state).toBe("VERIFIED");
      expect(after?.attachedAtMs).toBe(before?.attachedAtMs);
    });
  });

  describe("when a whole person's history is folded stream by stream", () => {
    /** @scenario "The per-identifier fold and the per-user fold agree on a whole history" */
    it("reaches the same heads the per-user reducer reaches", () => {
      const history = [
        attached("idf_google", { provider: "google", state: "VERIFIED" }),
        attached("idf_email", { occurredAt: T0 + 1000 }),
        verified("idf_email", T0 + 2000),
        primaryChanged({ identifierId: "idf_email", occurredAt: T0 + 3000 }),
        primaryChanged({
          identifierId: "idf_google",
          previousIdentifierId: "idf_email",
          occurredAt: T0 + 4000,
        }),
        detached("idf_email", T0 + 5000),
        proposed(),
      ];
      const perUser = foldUser(history);
      for (const identifierId of ["idf_google", "idf_email"]) {
        expect(foldStream(identifierId, history)).toEqual(
          perUser.identifiers[identifierId],
        );
      }
    });

    /** @scenario "Erasure folds the same both ways only because the fact names every head" */
    it("agrees on an erased history too, once the erasure names every head", () => {
      const heads = foldUser([
        attached("idf_google", { provider: "google", state: "VERIFIED" }),
        attached("idf_email", { value: "sam@b.dev", occurredAt: T0 + 1 }),
      ]);
      const history = [
        attached("idf_google", { provider: "google", state: "VERIFIED" }),
        attached("idf_email", { value: "sam@b.dev", occurredAt: T0 + 1 }),
        ...userErasureFacts({ heads, userId: USER, actor: ACTOR }).map(
          (fact): IdentityFact => ({ ...fact, occurredAt: T0 + 4 }),
        ),
      ];
      const perUser = foldUser(history);
      for (const identifierId of ["idf_google", "idf_email"]) {
        expect(foldStream(identifierId, history)).toEqual(
          perUser.identifiers[identifierId],
        );
      }
      expect(perUser.identifiers.idf_email?.value).toBeNull();
    });
  });
});

describe("what one head cannot see", () => {
  // Two histories fold differently, and ADR-127 names both. Neither can be
  // stated by a command — `primaryChangeFacts` cannot produce either shape —
  // so both need a partial replay window to exist at all. They are pinned here
  // rather than left to be discovered, because a per-identifier fold that
  // agreed everywhere would mean the split had changed nothing.

  describe("when a promotion's own head is outside the window", () => {
    /** @scenario "A promotion whose promoted head is absent still demotes the previous" */
    it("demotes the previous per identifier, where the person's fold demotes nobody", () => {
      const history = [
        attached("idf_personal", { state: "VERIFIED" }),
        primaryChanged({ identifierId: "idf_personal" }),
        // The attach of idf_work is not in the window; the promotion of it is.
        primaryChanged({
          identifierId: "idf_work",
          previousIdentifierId: "idf_personal",
          occurredAt: T0 + 7,
        }),
      ];
      // The person's fold makes the demotion conditional on the promotion
      // taking, and it did not take.
      expect(foldUser(history).identifiers.idf_personal?.state).toBe("PRIMARY");
      // One head cannot check that, so it demotes and the person is left with
      // no PRIMARY — which the read fork answers from the most recently
      // VERIFIED identifier.
      expect(foldStream("idf_personal", history)?.state).toBe("VERIFIED");
      expect(foldStream("idf_work", history)).toBeNull();
    });
  });

  describe("when a promotion names no previous and somebody is standing", () => {
    /** @scenario "A promotion naming no previous leaves an older PRIMARY standing" */
    it("leaves two PRIMARY per identifier, where the person's fold sweeps one away", () => {
      const history = [
        attached("idf_personal", { state: "VERIFIED" }),
        attached("idf_work", { state: "VERIFIED", occurredAt: T0 + 1 }),
        primaryChanged({ identifierId: "idf_personal" }),
        // The shape the old guard could state: it named only the first
        // standing PRIMARY it found, and null when it found none.
        primaryChanged({ identifierId: "idf_work", occurredAt: T0 + 8 }),
      ];
      const perUser = foldUser(history);
      expect(perUser.identifiers.idf_personal?.state).toBe("VERIFIED");
      expect(perUser.identifiers.idf_work?.state).toBe("PRIMARY");
      // The fact is never routed to idf_personal, so its stream never hears.
      expect(foldStream("idf_personal", history)?.state).toBe("PRIMARY");
      expect(foldStream("idf_work", history)?.state).toBe("PRIMARY");
    });
  });

  describe("when an erasure names fewer identifiers than the person holds", () => {
    /** @scenario "Erasure folds the same both ways only because the fact names every head" */
    it("leaves the unnamed head's address standing per identifier", () => {
      const history = [
        attached("idf_a"),
        attached("idf_b", { value: "sam@b.dev", occurredAt: T0 + 1 }),
        erased(["idf_a"]),
      ];
      // The person's fold sweeps every head and ignores the list.
      expect(foldUser(history).identifiers.idf_b?.value).toBeNull();
      // One head only hears what the fact names — which is why the command
      // builds that list from a read of the whole person.
      expect(foldStream("idf_b", history)?.value).toBe("sam@b.dev");
      expect(foldStream("idf_a", history)?.value).toBeNull();
    });
  });
});

describe("primaryChangeFacts", () => {
  describe("when the person holds no PRIMARY", () => {
    /** @scenario "A first primary change routes one stream only" */
    it("states one promotion naming no previous", () => {
      const heads = foldUser([attached("idf_work", { state: "VERIFIED" })]);
      expect(
        primaryChangeFacts({ heads, identifierId: "idf_work", actor: ACTOR }),
      ).toEqual([
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_work",
            previousIdentifierId: null,
            actor: ACTOR,
          },
        },
      ]);
    });
  });

  describe("when another identifier is standing PRIMARY", () => {
    /** @scenario "A promotion routes a demotion to the identifier losing PRIMARY" */
    it("names it, so the demotion reaches its stream", () => {
      const heads = foldUser([
        attached("idf_personal", { state: "VERIFIED" }),
        attached("idf_work", { state: "VERIFIED", occurredAt: T0 + 1 }),
        primaryChanged({ identifierId: "idf_personal" }),
      ]);
      const facts = primaryChangeFacts({
        heads,
        identifierId: "idf_work",
        actor: ACTOR,
      });
      expect(facts).toHaveLength(1);
      expect(facts[0]?.data).toMatchObject({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
    });
  });

  describe("when a partial-window replay left two standing PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY survives, whoever was standing" */
    it("names every one of them, so the sweep survives the split", () => {
      // The fold used to demote whatever it found. A per-identifier fold sees
      // one head, so the command is what has to name them all.
      const standing = foldUser([
        attached("idf_a", { state: "VERIFIED" }),
        attached("idf_b", { state: "VERIFIED", occurredAt: T0 + 1 }),
      ]);
      const heads: IdentityHeads = {
        ...standing,
        identifiers: Object.fromEntries(
          Object.entries(standing.identifiers).map(([id, head]) => [
            id,
            { ...head, state: "PRIMARY" as const },
          ]),
        ),
      };
      const facts = primaryChangeFacts({
        heads,
        identifierId: "idf_new",
        actor: ACTOR,
      });
      expect(
        [...facts].sort((left, right) =>
          String(left.data.previousIdentifierId).localeCompare(
            String(right.data.previousIdentifierId),
          ),
        ),
      ).toEqual([
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_new",
            previousIdentifierId: "idf_a",
            actor: ACTOR,
          },
        },
        {
          type: "lw.identity.primary_changed",
          data: {
            identifierId: "idf_new",
            previousIdentifierId: "idf_b",
            actor: ACTOR,
          },
        },
      ]);
    });
  });
});

describe("userErasureFacts", () => {
  describe("when the person holds identifiers the caller never listed", () => {
    /** @scenario "Erasure names every identifier the person actually holds" */
    it("names every head the projection carries, tombstones included", () => {
      const heads = foldUser([
        attached("idf_a"),
        attached("idf_b", { value: "sam@b.dev", occurredAt: T0 + 1 }),
        detached("idf_b"),
      ]);
      const [fact] = userErasureFacts({ heads, userId: USER, actor: ACTOR });
      expect(fact?.data).toMatchObject({
        userId: USER,
        erasedIdentifierIds: ["idf_a", "idf_b"],
      });
    });
  });
});
