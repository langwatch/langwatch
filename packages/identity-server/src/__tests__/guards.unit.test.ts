import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
  IDENTIFIER_DETACHED_EVENT_TYPE,
  IDENTIFIER_VERIFIED_EVENT_TYPE,
  IdentityCommandRefusedError,
} from "@langwatch/identity";
import { describe, expect, it } from "vitest";
import { IdentityGuards } from "../guards";
import {
  ACTOR,
  attachData,
  fact,
  headsWith,
  InMemoryHeads,
  T0,
  USER,
} from "./support/in-memory-heads";
import { InMemoryReservations } from "./support/in-memory-reservations";
import { InMemoryUsers } from "./support/in-memory-users";

/** No legacy user holds anything, which is what every test below assumes
 *  unless it says otherwise — the cross-population collision guard has its
 *  own describe at the bottom of the verify and primary sections. */
const users = new InMemoryUsers();

describe("attachIdentifier guard", () => {
  describe("when a ceremony attaches an OAuth identifier", () => {
    /** @scenario "Attaching an identifier records the fact and the projection row" */
    it("states the normalized email, domain, and HMAC hash as a VERIFIED arrival", async () => {
      const heads = new InMemoryHeads();
      heads.hashKeys.set(USER, "key_material");
      const facts = await new IdentityGuards(heads, users, new InMemoryReservations()).attachIdentifier(
        attachData(),
      );
      expect(facts).toHaveLength(1);
      const attached = facts[0]!;
      expect(attached.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      if (attached.type !== IDENTIFIER_ATTACHED_EVENT_TYPE) return;
      expect(attached.data.value).toBe("sam.j+x@acme.com");
      expect(attached.data.domain).toBe("acme.com");
      expect(attached.data.identifierHash).toMatch(/^hmac:[0-9a-f]{64}$/);
      expect(attached.data.state).toBe("VERIFIED");
      // The payload rule (ADR-101 §4): the payload's whole shape — nothing
      // secret-shaped exists to leak.
      expect(Object.keys(attached.data).sort()).toEqual([
        "accountId",
        "actor",
        "connectionId",
        "domain",
        "identifierHash",
        "identifierId",
        "provider",
        // The provider's own subject (ADR-116). An identifier, not a secret:
        // it is the public `sub` an IdP puts in a token, and the projection
        // needs it to answer a callback without the legacy Account row.
        "providerAccountId",
        // better-auth's own provider id, unfolded — what the projected
        // `Account` row is keyed by (ADR-116).
        "providerId",
        "state",
        "userId",
        "value",
      ]);
    });

    it("records a null hash when the user's hash key is not yet minted", async () => {
      const facts = await new IdentityGuards(new InMemoryHeads(), users, new InMemoryReservations()).attachIdentifier(
        attachData(),
      );
      expect(facts[0]?.data).toMatchObject({ identifierHash: null });
    });

    it("attaches email-provider identifiers ATTACHED, awaiting the ceremony", async () => {
      const facts = await new IdentityGuards(new InMemoryHeads(), users, new InMemoryReservations()).attachIdentifier(
        attachData({
          provider: "email",
          providerId: null,
          providerAccountId: null,
          accountId: null,
        }),
      );
      expect(facts[0]?.data).toMatchObject({ state: "ATTACHED" });
    });
  });

  describe("when another user already holds the address lock", () => {
    /** @scenario "A VERIFIED arrival that loses the address lock dead-ends" */
    it("dead-ends the VERIFIED-arrival attach instead of granting the value", async () => {
      const heads = new InMemoryHeads();
      const reservations = new InMemoryReservations();
      await reservations.claim({
        // Tagged, because the tag is part of the address (6b62a98725): the
        // lock this attach contends for is the one on the value it actually
        // normalizes to, not on the untagged mailbox beside it.
        normalizedValue: "sam.j+x@acme.com",
        userId: "user_other",
        identifierId: "idf_theirs",
        commandId: "idcmd_theirs",
      });
      const facts = await new IdentityGuards(
        heads,
        users,
        reservations,
      ).attachIdentifier(attachData());
      // No caller to refuse on this side: an IdP callback that failed would
      // tell the customer nothing they could act on (D01).
      expect(facts).toHaveLength(2);
      expect(facts[0]!.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({ state: "ATTACHED" });
      expect(facts[1]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
      expect(facts[1]!.data).toMatchObject({ reason: "uniqueness_race_lost" });
    });

    it("still verifies the holder's own re-attach of their value", async () => {
      const heads = new InMemoryHeads();
      const reservations = new InMemoryReservations();
      await reservations.claim({
        // Tagged, because the tag is part of the address (6b62a98725): the
        // lock this attach contends for is the one on the value it actually
        // normalizes to, not on the untagged mailbox beside it.
        normalizedValue: "sam.j+x@acme.com",
        userId: USER,
        identifierId: "idf_mine",
        commandId: "idcmd_mine",
      });
      const facts = await new IdentityGuards(
        heads,
        users,
        reservations,
      ).attachIdentifier(attachData());
      expect(facts).toHaveLength(1);
      expect(facts[0]!.data).toMatchObject({ state: "VERIFIED" });
    });

    /** @scenario "Two VERIFIED arrivals for one address: exactly one holds it" */
    it("lets exactly one of two concurrent arrivals end VERIFIED, live and on replay", async () => {
      // Two IdP callbacks for one address, arriving through the same lock.
      // Neither has a caller to refuse, so the loser resolves by dead-ending
      // — but only ONE may hold the address, and which one must not depend on
      // when the projection is read.
      const heads = new InMemoryHeads();
      const reservations = new InMemoryReservations();
      const guards = new IdentityGuards(heads, users, reservations);
      const other = "user_other";

      const [mine, theirs] = [
        await guards.attachIdentifier(attachData({ commandId: "idcmd_mine" })),
        await guards.attachIdentifier(
          attachData({
            userId: other,
            tenantId: other,
            commandId: "idcmd_theirs",
            accountId: "acc_2",
            providerAccountId: "gid_456",
            actor: { type: "user", id: other },
          }),
        ),
      ];
      heads.fold(USER, mine);
      heads.fold(other, theirs);

      const verifiedHolders = (state: InMemoryHeads) =>
        [...state.heads.values()]
          .flatMap((held) => Object.values(held.identifiers))
          .filter((head) => head.state === "VERIFIED")
          .map((head) => head.userId);

      expect(verifiedHolders(heads)).toEqual([USER]);
      expect(
        Object.values(heads.heads.get(other)?.identifiers ?? {}).map(
          (head) => head.state,
        ),
      ).toEqual(["DEAD_END"]);

      // The same emissions, folded from scratch in the same order: the loser
      // is the loser because the facts say so, not because of read timing.
      const replayed = new InMemoryHeads();
      replayed.fold(USER, mine);
      replayed.fold(other, theirs);
      expect(verifiedHolders(replayed)).toEqual([USER]);
      expect(replayed.heads.get(other)).toEqual(heads.heads.get(other));
    });

    /** @scenario "An email attach takes no address lock" */
    it("takes no lock for an ATTACHED arrival, so nobody can squat an address", async () => {
      const reservations = new InMemoryReservations();
      await new IdentityGuards(
        new InMemoryHeads(),
        users,
        reservations,
      ).attachIdentifier(
        attachData({
          provider: "email",
          providerId: null,
          providerAccountId: null,
          accountId: null,
        }),
      );
      expect(reservations.held.size).toBe(0);
    });
  });

  describe("when the same fact is stated twice", () => {
    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("derives the same identifier id whatever the command id", async () => {
      const guards = new IdentityGuards(new InMemoryHeads(), users, new InMemoryReservations());
      const first = await guards.attachIdentifier(attachData());
      const second = await guards.attachIdentifier(
        attachData({ commandId: "idcmd_2" }),
      );
      expect((first[0]!.data as { identifierId: string }).identifierId).toBe(
        (second[0]!.data as { identifierId: string }).identifierId,
      );
    });
  });

  describe("when the heads already carry the identifier", () => {
    /** @scenario "A fact the heads already carry is not stated again" */
    it("states nothing, whatever the command id", async () => {
      const heads = new InMemoryHeads();
      const guards = new IdentityGuards(heads, users, new InMemoryReservations());
      heads.fold(USER, await guards.attachIdentifier(attachData()));

      const restated = await guards.attachIdentifier(
        attachData({ commandId: "backfill:acc_1" }),
      );
      expect(restated).toEqual([]);
    });

    it("still states an identifier the heads lack", async () => {
      const heads = new InMemoryHeads();
      const guards = new IdentityGuards(heads, users, new InMemoryReservations());
      const first = await guards.attachIdentifier(attachData());
      heads.fold(USER, first);

      const another = await guards.attachIdentifier(
        attachData({ commandId: "idcmd_2", providerAccountId: "gid_2" }),
      );
      expect(another).toHaveLength(1);
      expect((another[0]!.data as { identifierId: string }).identifierId).not.toBe(
        (first[0]!.data as { identifierId: string }).identifierId,
      );
    });
  });
});

describe("verifyIdentifier guard", () => {
  const verify = (heads: InMemoryHeads, identifierId = "idf_work") =>
    new IdentityGuards(heads, users, new InMemoryReservations()).verifyIdentifier({
      tenantId: USER,
      userId: USER,
      commandId: "idcmd_v1",
      identifierId,
      verificationId: "verif_1",
      method: "magic-link",
      occurredAtMs: T0 + 1000,
      actor: ACTOR,
    });

  describe("when another user already holds the verified value", () => {
    /** @scenario "A verification refused because another user holds the address" */
    it("refuses with the collision code instead of verifying it", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })));
      heads.activeByValue.set("sam@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      await expect(verify(heads)).rejects.toMatchObject({
        code: "identity_email_in_use",
      });
    });
  });

  describe("when two verifications of one address race", () => {
    /** @scenario "Two concurrent verifications of one address: the loser is refused before any fact" */
    it("refuses the loser on the lock, before it states anything", async () => {
      const reservations = new InMemoryReservations();
      await reservations.claim({
        normalizedValue: "sam@acme.com",
        userId: "user_other",
        identifierId: "idf_theirs",
        commandId: "idcmd_theirs",
      });
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );

      await expect(
        new IdentityGuards(heads, users, reservations).verifyIdentifier({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link",
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });
    });

    /** @scenario "A retried verification holds the lock it already took" */
    it("lets the same command claim the lock it already holds", async () => {
      const reservations = new InMemoryReservations();
      await reservations.claim({
        normalizedValue: "sam@acme.com",
        userId: "user_other",
        identifierId: "idf_theirs",
        commandId: "idcmd_v1",
      });
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );

      const facts = await new IdentityGuards(
        heads,
        users,
        reservations,
      ).verifyIdentifier({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_v1",
        identifierId: "idf_work",
        verificationId: "verif_1",
        method: "magic-link",
        occurredAtMs: T0 + 1000,
        actor: ACTOR,
      });
      expect(facts[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
    });
  });

  describe("when the value is unheld", () => {
    it("verifies the ATTACHED identifier with the ceremony's proof trail", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })));
      const facts = await verify(heads);
      expect(facts[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({
        identifierId: "idf_work",
        verificationId: "verif_1",
        method: "magic-link",
      });
    });

    it("states nothing for an identifier already VERIFIED", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "VERIFIED" })));
      expect(await verify(heads)).toEqual([]);
    });

    it("refuses to verify an identifier the user does not hold", async () => {
      await expect(verify(new InMemoryHeads(), "idf_missing")).rejects.toMatchObject({
        code: "identity_identifier_not_found",
      });
    });

    it("refuses to verify a tombstone", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "DETACHED" })));
      await expect(verify(heads)).rejects.toMatchObject({
        code: "identity_identifier_not_verifiable",
      });
    });
  });

  describe("when a user outside the identity population holds the address", () => {
    const attachedTo = (heads: InMemoryHeads) =>
      heads.heads.set(
        USER,
        headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })),
      );

    /** @scenario "Verification is refused when a legacy user holds the address" */
    it("refuses with the handled code and states nothing", async () => {
      const heads = new InMemoryHeads();
      attachedTo(heads);
      const legacy = new InMemoryUsers().holding({
        userId: "user_bob",
        email: "sam@acme.com",
      });

      await expect(
        new IdentityGuards(heads, legacy, new InMemoryReservations()).verifyIdentifier({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link",
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });

      // Refused, not dead-ended: the projection is untouched, so nothing the
      // fold would replay changed and Bob still resolves by that address.
      expect(heads.heads.get(USER)?.identifiers.idf_work?.state).toBe(
        "ATTACHED",
      );
    });

    it("verifies normally when the holder IS this user", async () => {
      const heads = new InMemoryHeads();
      attachedTo(heads);
      const legacy = new InMemoryUsers().holding({
        userId: USER,
        email: "sam@acme.com",
      });

      const facts = await new IdentityGuards(heads, legacy, new InMemoryReservations()).verifyIdentifier({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_v1",
        identifierId: "idf_work",
        verificationId: "verif_1",
        method: "magic-link",
        occurredAtMs: T0 + 1000,
        actor: ACTOR,
      });

      expect(facts[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
    });

    it("compares case-insensitively, the way the unique index does", async () => {
      const heads = new InMemoryHeads();
      attachedTo(heads);
      const legacy = new InMemoryUsers().holding({
        userId: "user_bob",
        email: "SAM@Acme.com",
      });

      await expect(
        new IdentityGuards(heads, legacy, new InMemoryReservations()).verifyIdentifier({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_v1",
          identifierId: "idf_work",
          verificationId: "verif_1",
          method: "magic-link",
          occurredAtMs: T0 + 1000,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });
    });

    it("lets an ATTACHED identifier of theirs block nobody", async () => {
      // The other direction of the same rule: an unverified identifier is not
      // a claim, so a legacy population that holds nothing leaves verify free
      // even though somebody else has merely ATTACHED the value.
      const heads = new InMemoryHeads();
      attachedTo(heads);
      const facts = await verify(heads);
      expect(facts[0]!.type).toBe(IDENTIFIER_VERIFIED_EVENT_TYPE);
    });
  });
});

describe("markPrimary guard", () => {
  describe("when another identifier holds PRIMARY", () => {
    /** @scenario "Exactly one PRIMARY identifier per user" */
    it("promotes the VERIFIED identifier and names the previous PRIMARY", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(
          fact({ identifierId: "idf_work", state: "VERIFIED" }),
          fact({ identifierId: "idf_personal", state: "PRIMARY", value: "sam@personal.dev" }),
        ),
      );
      const facts = await new IdentityGuards(heads, users, new InMemoryReservations()).markPrimary({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_p1",
        identifierId: "idf_work",
        occurredAtMs: T0 + 2000,
        actor: ACTOR,
      });
      expect(facts[0]!.data).toMatchObject({
        identifierId: "idf_work",
        previousIdentifierId: "idf_personal",
      });
    });

    it("refuses an identifier that is not VERIFIED", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })));
      await expect(
        new IdentityGuards(heads, users, new InMemoryReservations()).markPrimary({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_p1",
          identifierId: "idf_work",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_primary_requires_verified" });
    });
  });

  describe("when the address a switch would promote is another user's User.email", () => {
    /** @scenario "A primary switch that collides is refused by the guard, not the database" */
    it("refuses with the handled code, and no fact is stated", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(
          fact({
            identifierId: "idf_home",
            state: "VERIFIED",
            value: "sam@home.net",
          }),
          fact({ identifierId: "idf_work", state: "PRIMARY" }),
        ),
      );
      const legacy = new InMemoryUsers().holding({
        userId: "user_other",
        email: "sam@home.net",
      });

      await expect(
        new IdentityGuards(heads, legacy, new InMemoryReservations()).markPrimary({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_p1",
          identifierId: "idf_home",
          occurredAtMs: T0 + 2000,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });

      // The guard refused BEFORE the fact, which is the whole point: the
      // fold writes `User.email` from PRIMARY, so the alternative is a
      // unique-constraint failure inside a projection nobody is waiting on.
      expect(heads.heads.get(USER)?.identifiers.idf_work?.state).toBe(
        "PRIMARY",
      );
      expect(heads.heads.get(USER)?.identifiers.idf_home?.state).toBe(
        "VERIFIED",
      );
    });
  });
});

describe("detachIdentifier guard", () => {
  const detach = (heads: InMemoryHeads, identifierId: string) =>
    new IdentityGuards(heads, users, new InMemoryReservations()).detachIdentifier({
      tenantId: USER,
      userId: USER,
      commandId: "idcmd_d1",
      identifierId,
      occurredAtMs: T0 + 5000,
      actor: ACTOR,
    });

  describe("when the target is PRIMARY", () => {
    /** @scenario "A PRIMARY identifier never detaches directly" */
    it("refuses with identity_primary_must_demote_first and states nothing", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ identifierId: "idf_personal", state: "PRIMARY" })));
      const attempt = detach(heads, "idf_personal");
      await expect(attempt).rejects.toBeInstanceOf(IdentityCommandRefusedError);
      await expect(attempt).rejects.toMatchObject({
        code: "identity_primary_must_demote_first",
      });
    });
  });

  describe("when the target is VERIFIED", () => {
    /** @scenario "A detached identifier is a tombstone, forever resolvable" */
    it("states the detach; a second detach states nothing", async () => {
      const heads = new InMemoryHeads();
      const guards = new IdentityGuards(heads, users, new InMemoryReservations());
      const attached = await guards.attachIdentifier(attachData());
      const identifierId = (attached[0]!.data as { identifierId: string }).identifierId;
      heads.fold(USER, attached);
      // A second way in, so this exercises tombstone semantics rather than
      // the strands guard — detaching somebody's last verified identifier is
      // refused outright (D07).
      heads.fold(
        USER,
        await guards.attachIdentifier(
          attachData({
            commandId: "idcmd_keep",
            accountId: "acc_keep",
            providerAccountId: "gid_keep",
            value: "sam.keep@acme.com",
          }),
        ),
      );

      const detached = await detach(heads, identifierId);
      expect(detached).toHaveLength(1);
      heads.fold(USER, detached, T0 + 5000);
      expect(heads.heads.get(USER)?.identifiers[identifierId]).toMatchObject({
        state: "DETACHED",
        detachedAtMs: T0 + 5000,
        value: "sam.j+x@acme.com",
      });
      expect(await detach(heads, identifierId)).toEqual([]);
    });
  });
});

describe("eraseUser guard", () => {
  describe("when a user with identifiers is erased", () => {
    /** @scenario "Erasure wipes values and leaves a replayable tombstone" */
    it("names every identifier the heads carry", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(fact({ identifierId: "idf_a" }), fact({ identifierId: "idf_b" })),
      );
      const facts = await new IdentityGuards(heads, users, new InMemoryReservations()).eraseUser({
        tenantId: USER,
        userId: USER,
        commandId: "idcmd_e1",
        occurredAtMs: T0 + 9000,
        actor: { type: "system", id: "ops:erasure-request" },
      });
      expect(
        (facts[0]!.data as { erasedIdentifierIds: string[] }).erasedIdentifierIds.sort(),
      ).toEqual(["idf_a", "idf_b"]);
    });
  });
});

describe("detachIdentifier strands guard", () => {
  const detach = (heads: InMemoryHeads, identifierId: string) =>
    new IdentityGuards(
      heads,
      users,
      new InMemoryReservations(),
    ).detachIdentifier({
      tenantId: USER,
      userId: USER,
      commandId: "idcmd_d2",
      identifierId,
      occurredAtMs: T0 + 5000,
      actor: ACTOR,
    });

  describe("when the passkey is the only verified way in", () => {
    /** @scenario "Removing the last way in is refused" */
    it("refuses with identity_detach_strands_user and leaves the passkey working", async () => {
      const heads = new InMemoryHeads();
      const passkey = fact({
        identifierId: "idf_passkey",
        provider: "passkey",
        value: "cred_abc",
        domain: null,
        state: "VERIFIED",
      });
      heads.heads.set(USER, headsWith(passkey));

      const attempt = detach(heads, "idf_passkey");
      await expect(attempt).rejects.toMatchObject({
        code: "identity_detach_strands_user",
      });
      // Refused before any fact exists, so the passkey still signs them in.
      expect(heads.heads.get(USER)?.identifiers.idf_passkey?.state).toBe(
        "VERIFIED",
      );
    });
  });

  describe("when only passkeys would be left", () => {
    /** @scenario "Removing is refused when nothing is left to recover with" */
    it("refuses because losing the other would leave no way back", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(
          fact({
            identifierId: "idf_passkey_a",
            provider: "passkey",
            value: "cred_a",
            domain: null,
          }),
          fact({
            identifierId: "idf_passkey_b",
            provider: "passkey",
            value: "cred_b",
            domain: null,
          }),
        ),
      );

      // Two passkeys and no verified email: removing one leaves a way IN but
      // no address anybody could be recovered through.
      await expect(detach(heads, "idf_passkey_a")).rejects.toMatchObject({
        code: "identity_detach_strands_user",
      });
    });

    /** @scenario "Removal follows the same guards as every other identifier" */
    it("allows the removal once a verified email is there to recover through", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(
          fact({
            identifierId: "idf_passkey_a",
            provider: "passkey",
            value: "cred_a",
            domain: null,
          }),
          fact({ identifierId: "idf_email", provider: "email" }),
        ),
      );

      expect(await detach(heads, "idf_passkey_a")).toEqual([
        {
          type: IDENTIFIER_DETACHED_EVENT_TYPE,
          data: { identifierId: "idf_passkey_a", actor: ACTOR },
        },
      ]);
    });

    it("does not refuse an unverified identifier, which strands nobody", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(
        USER,
        headsWith(
          fact({
            identifierId: "idf_unverified",
            provider: "email",
            state: "ATTACHED",
            verifiedAtMs: null,
          }),
        ),
      );

      // Nobody could have signed in with it, so removing it takes nothing
      // away — the guard is about ways IN, not about rows.
      expect(await detach(heads, "idf_unverified")).toHaveLength(1);
    });
  });
});
