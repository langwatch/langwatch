// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Nurturing's key copy through the tenancy guards: the upsert is the fold rule in SQL, and the
 * memory twin folding the same facts must hold the same copy.
 * Spec: enterprise/modules/nurturing/specs/gateway-facts.feature
 */
import { randomUUID } from "node:crypto";

import { createTenantId } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { nurturingVirtualKeysMap } from "../../../eventing/nurturing-project-usage.pipeline.ts";
import {
  erasedUserHashOf,
  type NurturingVirtualKeyFact,
} from "../../../rules/nurturing-virtual-key.rules.ts";
import { MemoryNurturingVirtualKeyRepository } from "../../memory/memory.nurturing-gateway-key.repository.ts";
import { PrismaNurturingErasedUserRepository } from "../prisma.nurturing-erased-user.repository.ts";
import { PrismaNurturingVirtualKeyRepository } from "../prisma.nurturing-gateway-key.repository.ts";
import { stoppedBeforeRecheck } from "./nurturing-stopped-worker.test-helpers.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const run = randomUUID();
const organizationIds = [`test-nurturing-key-a-${run}`, `test-nurturing-key-b-${run}`];
const [firstOrganization, secondOrganization] = organizationIds as [string, string];
const keyId = (name: string) => `vk_test_${name}_${run}`;
const erasedUserIds = new Set<string>();
/** A person a test erases; their erasure mark is removed with the test's rows. */
const erasedPerson = (name: string) => {
  const userId = `test-nurturing-key-${name}-${run}`;
  erasedUserIds.add(userId);
  return userId;
};
const erased = erasedPerson("erased");

const fact = (overrides: Partial<NurturingVirtualKeyFact>): NurturingVirtualKeyFact => ({
  virtualKeyId: keyId("folded"),
  organizationId: firstOrganization,
  action: "created",
  name: "Jane's key",
  actorUserId: "user-creator",
  principalUserId: "user-first",
  purpose: "USER",
  occurredAt: 1_000,
  ...overrides,
});

/** One fact written as the usage pipeline's key lane writes it, live or on replay. */
const keyLane = (keys: PrismaNurturingVirtualKeyRepository) =>
  nurturingVirtualKeysMap(keys).map.store;
const writeFact = (
  keys: PrismaNurturingVirtualKeyRepository,
  next: NurturingVirtualKeyFact,
  tenant = "project-1",
) =>
  keyLane(keys).append(next, {
    tenantId: createTenantId(tenant),
    aggregateId: `vk:${next.virtualKeyId}`,
  });

/** Runs the same steps on Postgres and then on the memory twin, so both hold the same facts. */
async function onEach<Repository>(
  repositories: readonly Repository[],
  steps: (repository: Repository) => Promise<void>,
): Promise<void> {
  for (const repository of repositories) await steps(repository);
}

describe.skipIf(!databaseUrl)("given nurturing's key copy in Postgres", () => {
  let connection: PrismaConnection;
  let keys: PrismaNurturingVirtualKeyRepository;

  beforeAll(() => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:virtual-keys"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    keys = PrismaNurturingVirtualKeyRepository.create({ prisma: connection.client });
  });

  afterAll(async () => {
    if (!connection) return;
    for (const organizationId of organizationIds) {
      await connection.client.nurturingVirtualKey.deleteMany({ where: { organizationId } });
    }
    const userIdHash = { in: [...erasedUserIds].map(erasedUserHashOf) };
    await connection.client.nurturingErasedUser.deleteMany({ where: { userIdHash } });
    await connection.closeOnce();
  });

  describe("when a key's facts arrive late, out of order and twice", () => {
    /** @scenario "The key copy folds every lifecycle fact order-free in Postgres" */
    it("holds what the memory twin holds for the same facts", async () => {
      const disabled = fact({
        action: "disabled",
        name: "Renamed",
        principalUserId: "user-latest",
        occurredAt: 4_000,
      });
      const facts = [
        fact({ action: "rotated", name: "Renamed", actorUserId: null, occurredAt: 2_000 }),
        disabled,
        fact({}),
        fact({ action: "rotated", principalUserId: null, purpose: null, occurredAt: 5_000 }),
        fact({ action: "enabled", principalUserId: "user-middle", occurredAt: 3_000 }),
        disabled,
      ];
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const next of facts) {
        await keys.recordKeyFact({ fact: next });
        await twin.recordKeyFact({ fact: next });
      }
      const where = { organizationId: firstOrganization, virtualKeyId: keyId("folded") };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        {
          name: "Jane's key",
          occurredAt: 5_000,
          keyCreatedAt: 1_000,
          creatorUserId: "user-creator",
          principalUserId: "user-latest",
          principalUserIdAt: 4_000,
          purpose: "USER",
          disabledAt: 4_000,
          enabledAt: 3_000,
          revokedAt: null,
        },
      ]);
    });

    it("answers no copy for the key under another organization", async () => {
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("folded") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a fact names another organization for a copied key", () => {
    it("changes nothing, in Postgres as in the memory twin", async () => {
      const copied = fact({ virtualKeyId: keyId("fenced") });
      const elsewhere = fact({
        virtualKeyId: keyId("fenced"),
        organizationId: secondOrganization,
        action: "revoked",
        name: "Taken over",
        principalUserId: "user-elsewhere",
        occurredAt: 9_000,
      });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      for (const next of [copied, elsewhere]) {
        await keys.recordKeyFact({ fact: next });
        await twin.recordKeyFact({ fact: next });
      }
      const where = { organizationId: firstOrganization, virtualKeyId: keyId("fenced") };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { name: "Jane's key", principalUserId: "user-first", occurredAt: 1_000, revokedAt: null },
      ]);
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("fenced") }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a person named on keys in two organizations is erased, twice", () => {
    /** @scenario "An erased person is cleared from every key copy in Postgres" */
    it("names them on no copy, and a redelivered older fact naming them writes nothing back", async () => {
      const held = fact({ virtualKeyId: keyId("held"), principalUserId: erased });
      const made = fact({
        virtualKeyId: keyId("made"),
        organizationId: secondOrganization,
        actorUserId: erased,
      });
      await keys.recordKeyFact({ fact: held });
      await keys.recordKeyFact({ fact: made });

      for (let delivery = 0; delivery < 2; delivery++) await keys.forgetUser({ userId: erased });
      await keys.recordKeyFact({ fact: held });
      await keys.recordKeyFact({ fact: made });

      await expect(
        keys.findKey({ organizationId: firstOrganization, virtualKeyId: keyId("held") }),
      ).resolves.toMatchObject([{ principalUserId: null, creatorUserId: "user-creator" }]);
      await expect(
        keys.findKey({ organizationId: secondOrganization, virtualKeyId: keyId("made") }),
      ).resolves.toMatchObject([{ principalUserId: "user-first", creatorUserId: null }]);
    });
  });

  describe("when a fact stamped after the holder's stamp but before their erasure lands after it", () => {
    /** @scenario "A fact stamped before an erasure never names the erased holder again" */
    it("keeps the holder cleared, in Postgres as in the memory twin", async () => {
      const lateErased = erasedPerson("late-erased");
      const virtualKeyId = keyId("late");
      const stamped = (occurredAt: number) =>
        fact({ virtualKeyId, action: "rotated", principalUserId: lateErased, occurredAt });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      // T1 < T2, both stamped in 1970.
      await onEach([keys, twin], async (repository) => {
        await repository.recordKeyFact({ fact: stamped(1_000) });
        await repository.forgetUser({ userId: lateErased });
        await repository.recordKeyFact({ fact: stamped(2_000) });
      });
      const where = { organizationId: firstOrganization, virtualKeyId };

      await expect(keys.findKey(where)).resolves.toMatchObject([{ principalUserId: null }]);
      await expect(twin.findKey(where)).resolves.toMatchObject([{ principalUserId: null }]);
    });
  });

  describe("when an erased person's created fact, stamped before the erasure, lands late", () => {
    /** @scenario "A key is created for an erased person after their erasure" */
    it("copies the key naming no creator or holder, as the memory twin does", async () => {
      const person = erasedPerson("erased-before-copy");
      const virtualKeyId = keyId("copied-after-erasure");
      const created = fact({ virtualKeyId, actorUserId: person, principalUserId: person });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: created });
      });
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        {
          keyCreatedAt: 1_000,
          creatorUserId: null,
          principalUserId: null,
          principalUserIdAt: 1_000,
        },
      ]);
    });
  });

  describe("when a holder fact naming an erased person lands late on a key with no holder", () => {
    /** @scenario "A holder change for an erased person arrives late on a key with no holder" */
    it("keeps the key holderless, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-holder");
      const virtualKeyId = keyId("holderless");
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.recordKeyFact({ fact: fact({ virtualKeyId, principalUserId: null }) });
        await repository.forgetUser({ userId: person });
        const holderChange = fact({
          virtualKeyId,
          action: "rotated",
          principalUserId: person,
          occurredAt: 2_000,
        });
        await repository.recordKeyFact({ fact: holderChange });
      });
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { creatorUserId: "user-creator", principalUserId: null, principalUserIdAt: 2_000 },
      ]);
    });
  });

  describe("when a created fact naming an erased creator lands after a later fact", () => {
    /** @scenario "A late created fact never names an erased creator" */
    it("records the creation naming no creator, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-creator");
      const virtualKeyId = keyId("created-late");
      const rotated = fact({
        virtualKeyId,
        action: "rotated",
        actorUserId: null,
        occurredAt: 2_000,
      });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.recordKeyFact({ fact: rotated });
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: fact({ virtualKeyId, actorUserId: person }) });
      });
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([
        { keyCreatedAt: 1_000, creatorUserId: null, principalUserId: "user-first" },
      ]);
    });
  });

  describe("when a later fact naming an erased person lands before or after the erasure", () => {
    /** @scenario "A late fact naming an erased person ends the key with no holder, as if it landed first" */
    it("ends with no holder either way, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-latest-holder");
      const firstKey = keyId("erased-after-facts");
      const thenKey = keyId("erased-between-facts");
      const holderChange = (virtualKeyId: string) =>
        fact({ virtualKeyId, action: "rotated", principalUserId: person, occurredAt: 2_000 });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.recordKeyFact({ fact: fact({ virtualKeyId: firstKey }) });
        await repository.recordKeyFact({ fact: holderChange(firstKey) });
        await repository.recordKeyFact({ fact: fact({ virtualKeyId: thenKey }) });
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: holderChange(thenKey) });
        // Gateway's created fact, naming the earlier holder, redelivered after both.
        await repository.recordKeyFact({ fact: fact({ virtualKeyId: thenKey }) });
      });
      const where = (virtualKeyId: string) => ({ organizationId: firstOrganization, virtualKeyId });

      for (const virtualKeyId of [firstKey, thenKey]) {
        const held = await keys.findKey(where(virtualKeyId));

        expect(held).toEqual(await twin.findKey(where(virtualKeyId)));
        expect(held).toMatchObject([{ principalUserId: null, principalUserIdAt: 2_000 }]);
      }
    });
  });

  describe("when a holder change to another person, stamped before an erasure, lands after it", () => {
    /** @scenario "A holder change to another person, stamped before an erasure, still lands after it" */
    it("makes that person the holder, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-then-replaced");
      const virtualKeyId = keyId("replaced-after-erasure");
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.recordKeyFact({ fact: fact({ virtualKeyId, principalUserId: person }) });
        await repository.forgetUser({ userId: person });
        const handedOver = fact({
          virtualKeyId,
          action: "rotated",
          principalUserId: "user-next",
          occurredAt: 2_000,
        });
        await repository.recordKeyFact({ fact: handedOver });
      });
      const where = { organizationId: firstOrganization, virtualKeyId };

      const held = await keys.findKey(where);

      expect(held).toEqual(await twin.findKey(where));
      expect(held).toMatchObject([{ principalUserId: "user-next", principalUserIdAt: 2_000 }]);
    });
  });

  describe("when two holder facts share a stamp and one names an erased person", () => {
    /** @scenario "Two holder facts at one stamp, one naming an erased person, end the same in either order" */
    it("makes the other person the holder in either order, in Postgres as in the memory twin", async () => {
      const person = erasedPerson("erased-tied-holder");
      const erasedFirst = keyId("tie-erased-first");
      const otherFirst = keyId("tie-other-first");
      const naming = (virtualKeyId: string, principalUserId: string) =>
        fact({ virtualKeyId, action: "rotated", principalUserId, occurredAt: 2_000 });
      const twin = MemoryNurturingVirtualKeyRepository.create();
      await onEach([keys, twin], async (repository) => {
        await repository.forgetUser({ userId: person });
        await repository.recordKeyFact({ fact: naming(erasedFirst, person) });
        await repository.recordKeyFact({ fact: naming(erasedFirst, "user-next") });
        await repository.recordKeyFact({ fact: naming(otherFirst, "user-next") });
        await repository.recordKeyFact({ fact: naming(otherFirst, person) });
      });
      const where = (virtualKeyId: string) => ({ organizationId: firstOrganization, virtualKeyId });

      for (const virtualKeyId of [erasedFirst, otherFirst]) {
        const held = await keys.findKey(where(virtualKeyId));

        expect(held).toEqual(await twin.findKey(where(virtualKeyId)));
        expect(held).toMatchObject([{ principalUserId: "user-next", principalUserIdAt: 2_000 }]);
      }
    });
  });

  describe("when a fact naming a marked person is written and its worker stops before the re-check", () => {
    /** @scenario "A key fact naming a marked person stores them nowhere even if its re-check never runs" */
    it("rejects and leaves the key naming no creator or holder", async () => {
      const person = erasedPerson("erased-stopped");
      const virtualKeyId = keyId("stopped-before-recheck");
      await PrismaNurturingErasedUserRepository.create({ prisma: connection.client }).markErased({
        userId: person,
      });
      const stopping = PrismaNurturingVirtualKeyRepository.create({
        prisma: stoppedBeforeRecheck(connection.client),
      });
      const created = fact({ virtualKeyId, actorUserId: person, principalUserId: person });

      await expect(stopping.recordKeyFact({ fact: created })).rejects.toThrow("re-check");

      await expect(
        keys.findKey({ organizationId: firstOrganization, virtualKeyId }),
      ).resolves.toMatchObject([{ creatorUserId: null, principalUserId: null }]);
    });
  });

  describe("when a fact naming a person lands while their erasure is committing", () => {
    /** @scenario "A fact that lands while an erasure is committing still leaves the erased person off the key" */
    it("clears them after the upsert, the cleared holder keeping their stamp", async () => {
      const person = erasedPerson("erased-mid-commit");
      const heldKey = keyId("racing-holder");
      const madeKey = keyId("racing-creator");
      const held = fact({ virtualKeyId: heldKey, principalUserId: person });
      const made = fact({ virtualKeyId: madeKey, actorUserId: person });
      await writeFact(keys, held);
      await writeFact(keys, made);
      // The erasure's mark has committed but its clearing UPDATE has not run, as when the fact's
      // upsert read no mark and wrote them back after that UPDATE had passed the row.
      await connection.client.nurturingErasedUser.create({
        data: { userIdHash: erasedUserHashOf(person) },
      });

      await writeFact(keys, held);
      await writeFact(keys, made);

      const [holderCleared] = await keys.findKey({
        organizationId: firstOrganization,
        virtualKeyId: heldKey,
      });
      expect(holderCleared).toMatchObject({
        principalUserId: null,
        principalUserIdAt: held.occurredAt,
        creatorUserId: "user-creator",
      });
      await expect(
        keys.findKey({ organizationId: firstOrganization, virtualKeyId: madeKey }),
      ).resolves.toMatchObject([{ creatorUserId: null, principalUserId: "user-first" }]);
    });
  });
  describe("when the key lane writes facts of one stamp in both orders, and again", () => {
    /** @scenario "Two holder facts at one stamp, one naming an erased person, end the same in either order" */
    it("makes the other person the holder in either order, with no batch write to fold them in memory", async () => {
      const person = erasedPerson("erased-tied-lane");
      const erasedFirst = keyId("lane-tie-erased-first");
      const otherFirst = keyId("lane-tie-other-first");
      const naming = (virtualKeyId: string, principalUserId: string) =>
        fact({ virtualKeyId, action: "rotated", principalUserId, occurredAt: 2_000 });
      await keys.forgetUser({ userId: person });

      await writeFact(keys, naming(erasedFirst, person));
      await writeFact(keys, naming(erasedFirst, "user-next"));
      await writeFact(keys, naming(otherFirst, "user-next"));
      await writeFact(keys, naming(otherFirst, person));

      for (const virtualKeyId of [erasedFirst, otherFirst]) {
        await expect(
          keys.findKey({ organizationId: firstOrganization, virtualKeyId }),
        ).resolves.toMatchObject([{ principalUserId: "user-next", principalUserIdAt: 2_000 }]);
      }
      // A bulkAppend would fold a stamp's holders in memory, where the erased one can win the tie.
      expect(keyLane(keys).bulkAppend).toBeUndefined();
    });

    /** @scenario "Replaying the key copy twice leaves every row as it was" */
    it("leaves the row byte-identical when every fact is written a second time in reverse", async () => {
      const virtualKeyId = keyId("lane-twice");
      const facts = [
        fact({ virtualKeyId, occurredAt: 1_000 }),
        fact({ virtualKeyId, action: "rotated", principalUserId: "user-next", occurredAt: 2_000 }),
        fact({ virtualKeyId, action: "revoked", occurredAt: 3_000 }),
      ];
      for (const next of facts) await writeFact(keys, next);
      const where = { organizationId: firstOrganization, virtualKeyId };
      const first = JSON.stringify(await keys.findKey(where));

      for (const next of facts.toReversed()) await writeFact(keys, next);

      expect(JSON.stringify(await keys.findKey(where))).toBe(first);
    });

    /** @scenario "A key whose facts sit under two tenants ends the same in either tenant order" */
    it("holds the per-fact row whichever tenant each fact arrives under, in either order", async () => {
      const created = (virtualKeyId: string) => fact({ virtualKeyId, occurredAt: 1_000 });
      const rotated = (virtualKeyId: string) =>
        fact({ virtualKeyId, action: "rotated", principalUserId: "user-next", occurredAt: 2_000 });
      const createdFirst = keyId("lane-tenants-created-first");
      const rotatedFirst = keyId("lane-tenants-rotated-first");
      const twin = MemoryNurturingVirtualKeyRepository.create();

      await writeFact(keys, created(createdFirst), "project-1");
      await writeFact(keys, rotated(createdFirst), "project-2");
      await writeFact(keys, rotated(rotatedFirst), "project-2");
      await writeFact(keys, created(rotatedFirst), "project-1");
      for (const next of [created(createdFirst), rotated(createdFirst)]) {
        await twin.recordKeyFact({ fact: next });
      }
      for (const next of [rotated(rotatedFirst), created(rotatedFirst)]) {
        await twin.recordKeyFact({ fact: next });
      }

      for (const virtualKeyId of [createdFirst, rotatedFirst]) {
        const where = { organizationId: firstOrganization, virtualKeyId };
        const held = await keys.findKey(where);

        expect(held).toEqual(await twin.findKey(where));
        expect(held).toMatchObject([{ keyCreatedAt: 1_000, principalUserId: "user-next" }]);
      }
    });
  });
});
