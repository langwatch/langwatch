import {
  IDENTIFIER_ATTACHED_EVENT_TYPE,
  IDENTIFIER_DEAD_ENDED_EVENT_TYPE,
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

describe("attachIdentifier guard", () => {
  describe("when a ceremony attaches an OAuth identifier", () => {
    /** @scenario "Attaching an identifier records the fact and the projection row" */
    it("states the normalized email, domain, and HMAC hash as a VERIFIED arrival", async () => {
      const heads = new InMemoryHeads();
      heads.hashKeys.set(USER, "key_material");
      const facts = await new IdentityGuards(heads).attachIdentifier(
        attachData(),
      );
      expect(facts).toHaveLength(1);
      const attached = facts[0]!;
      expect(attached.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      if (attached.type !== IDENTIFIER_ATTACHED_EVENT_TYPE) return;
      expect(attached.data.value).toBe("sam.j@acme.com");
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
        "state",
        "userId",
        "value",
      ]);
    });

    it("records a null hash when the user's hash key is not yet minted", async () => {
      const facts = await new IdentityGuards(new InMemoryHeads()).attachIdentifier(
        attachData(),
      );
      expect(facts[0]?.data).toMatchObject({ identifierHash: null });
    });

    it("attaches email-provider identifiers ATTACHED, awaiting the ceremony", async () => {
      const facts = await new IdentityGuards(new InMemoryHeads()).attachIdentifier(
        attachData({ provider: "email", providerAccountId: null, accountId: null }),
      );
      expect(facts[0]?.data).toMatchObject({ state: "ATTACHED" });
    });
  });

  describe("when another user already actively holds the arriving value", () => {
    /** @scenario "Concurrent verification races dead-end the loser" */
    it("dead-ends the VERIFIED-arrival attach instead of granting the value", async () => {
      const heads = new InMemoryHeads();
      heads.activeByValue.set("sam.j@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      const facts = await new IdentityGuards(heads).attachIdentifier(attachData());
      expect(facts).toHaveLength(2);
      expect(facts[0]!.type).toBe(IDENTIFIER_ATTACHED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({ state: "ATTACHED" });
      expect(facts[1]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
      expect(facts[1]!.data).toMatchObject({ reason: "uniqueness_race_lost" });
    });

    it("still verifies the holder's own re-attach of their value", async () => {
      const heads = new InMemoryHeads();
      heads.activeByValue.set("sam.j@acme.com", {
        userId: USER,
        identifierId: "idf_mine",
      });
      const facts = await new IdentityGuards(heads).attachIdentifier(attachData());
      expect(facts).toHaveLength(1);
      expect(facts[0]!.data).toMatchObject({ state: "VERIFIED" });
    });
  });

  describe("when the same fact is stated twice", () => {
    /** @scenario "Identifier ids are deterministic so backfill and live emission converge" */
    it("derives the same identifier id whatever the command id", async () => {
      const guards = new IdentityGuards(new InMemoryHeads());
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
      const guards = new IdentityGuards(heads);
      heads.fold(USER, await guards.attachIdentifier(attachData()));

      const restated = await guards.attachIdentifier(
        attachData({ commandId: "backfill:acc_1" }),
      );
      expect(restated).toEqual([]);
    });

    it("still states an identifier the heads lack", async () => {
      const heads = new InMemoryHeads();
      const guards = new IdentityGuards(heads);
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
    new IdentityGuards(heads).verifyIdentifier({
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
    /** @scenario "Concurrent verification races dead-end the loser" */
    it("dead-ends the identifier instead of verifying it", async () => {
      const heads = new InMemoryHeads();
      heads.heads.set(USER, headsWith(fact({ state: "ATTACHED", verifiedAtMs: null })));
      heads.activeByValue.set("sam@acme.com", {
        userId: "user_other",
        identifierId: "idf_theirs",
      });
      const facts = await verify(heads);
      expect(facts).toHaveLength(1);
      expect(facts[0]!.type).toBe(IDENTIFIER_DEAD_ENDED_EVENT_TYPE);
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
      const facts = await new IdentityGuards(heads).markPrimary({
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
        new IdentityGuards(heads).markPrimary({
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
});

describe("detachIdentifier guard", () => {
  const detach = (heads: InMemoryHeads, identifierId: string) =>
    new IdentityGuards(heads).detachIdentifier({
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
      const guards = new IdentityGuards(heads);
      const attached = await guards.attachIdentifier(attachData());
      const identifierId = (attached[0]!.data as { identifierId: string }).identifierId;
      heads.fold(USER, attached);

      const detached = await detach(heads, identifierId);
      expect(detached).toHaveLength(1);
      heads.fold(USER, detached, T0 + 5000);
      expect(heads.heads.get(USER)?.identifiers[identifierId]).toMatchObject({
        state: "DETACHED",
        detachedAtMs: T0 + 5000,
        value: "sam.j@acme.com",
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
      const facts = await new IdentityGuards(heads).eraseUser({
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
