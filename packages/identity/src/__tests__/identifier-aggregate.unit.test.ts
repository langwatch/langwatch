import { describe, expect, it } from "vitest";
import type { IdentityFact, IdentityHeads } from "../facts";
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

/** The whole history of one stream, folded the way its own aggregate would. */
function foldStream(identifierId: string, facts: IdentityFact[]): IdentifierHead {
  return facts
    .filter((fact) => identityStreamsFor({ fact, userId: USER }).includes(identifierId))
    .reduce<IdentifierHead>(
      (head, fact) => reduceIdentifier({ identifierId, head, fact }),
      null,
    );
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
        expect(identityStreamsFor({ fact, userId: USER })).toEqual(["idf_work"]);
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
      expect(identityStreamsFor({ fact, userId: USER })).toEqual([
        "idf_work",
        "idf_personal",
      ]);
    });
  });

  describe("when nothing was demoted", () => {
    /** @scenario "A first primary change routes one stream only" */
    it("routes the promotion to one stream", () => {
      const fact = primaryChanged({ identifierId: "idf_work" });
      expect(identityStreamsFor({ fact, userId: USER })).toEqual(["idf_work"]);
    });
  });

  describe("when the fact is about the person", () => {
    /** @scenario "A proposal names no identifier, so it stays on the person's stream" */
    it("routes a link proposal to the person's stream alone", () => {
      expect(identityStreamsFor({ fact: proposed(), userId: USER })).toEqual([
        USER,
      ]);
    });

    /** @scenario "Erasure routes one fact per identifier the person actually holds" */
    it("routes an erasure to the person and to every identifier it names", () => {
      const fact = erased(["idf_work", "idf_personal"]);
      expect(identityStreamsFor({ fact, userId: USER })).toEqual([
        USER,
        "idf_work",
        "idf_personal",
      ]);
    });
  });

  describe("when any fact is routed", () => {
    /** @scenario "The tenant is still the person" */
    it("decides an aggregate id and never a tenant", () => {
      // The routing table answers with aggregate ids only. The tenant is the
      // user for every one of them, which is what keeps erasure a single
      // tenant scan over both the old streams and the new ones.
      const streams = [
        ...identityStreamsFor({ fact: attached("idf_work"), userId: USER }),
        ...identityStreamsFor({ fact: proposed(), userId: USER }),
      ];
      expect(streams).toEqual(["idf_work", USER]);
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
        facts.map((fact) => fact.data.previousIdentifierId).sort(),
      ).toEqual(["idf_a", "idf_b"]);
    });
  });
});

describe("userErasureFacts", () => {
  describe("when the person holds identifiers the caller never listed", () => {
    /** @scenario "Erasure routes one fact per identifier the person actually holds" */
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
