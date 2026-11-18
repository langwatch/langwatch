// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { virtualKeyPurposeSchema } from "@langwatch/gateway-contract";
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingVirtualKey,
  NurturingVirtualKeyFact,
} from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type { NurturingVirtualKeyRepository } from "../nurturing-gateway-key.repository.ts";
import {
  type NurturingErasedUserDatabase,
  PrismaNurturingErasedUserRepository,
} from "./prisma.nurturing-erased-user.repository.ts";

type NurturingVirtualKeyDatabase = Pick<PrismaClient, "nurturingVirtualKey" | "$executeRaw"> &
  NurturingErasedUserDatabase;

/** A purpose column holds gateway's own values; anything else is a corrupt row, not a USER. */
const storedPurposeSchema = virtualKeyPurposeSchema.nullable();

const timeOf = (at: Date | null) => at?.getTime() ?? null;

/**
 * Nurturing's own `NurturingVirtualKey` rows, folded from gateway's lifecycle facts, kept free of
 * an erased account by the erasure marks.
 */
export class PrismaNurturingVirtualKeyRepository
  extends PrismaRepository.for("NurturingVirtualKey")
  implements NurturingVirtualKeyRepository
{
  /**
   * `erasedUsers` defaults to the marks over the same client. It only writes marks: the writes'
   * own checks always read them on this client, through `markExists`.
   */
  static create({
    prisma,
    erasedUsers = PrismaNurturingErasedUserRepository.create({ prisma }),
  }: Readonly<{
    prisma: NurturingVirtualKeyDatabase;
    erasedUsers?: Pick<NurturingErasedUserRepository, "markErased">;
  }>): PrismaNurturingVirtualKeyRepository {
    return new PrismaNurturingVirtualKeyRepository(prisma, erasedUsers);
  }

  readonly #database: NurturingVirtualKeyDatabase;
  readonly #erasedUsers: Pick<NurturingErasedUserRepository, "markErased">;

  private constructor(
    prisma: NurturingVirtualKeyDatabase,
    erasedUsers: Pick<NurturingErasedUserRepository, "markErased">,
  ) {
    super(prisma);
    this.#database = prisma;
    this.#erasedUsers = erasedUsers;
  }

  /**
   * An upsert whose SET is `foldVirtualKeyFact`: GREATEST skips a null, so a state time only
   * moves later, and a stamped value moves only for a strictly later non-null one. A fact naming
   * another organization for a copied key changes nothing: a key never moves organization. An
   * erased creator reads null; an erased holder reads null stamped with the fact, so it clears a
   * holder stamped earlier, as `foldVirtualKeyFactWithoutErased` folds it; a holder fact at that
   * same stamp fills it, in either order once the mark is there. These checks only shorten how
   * long a row naming the person is visible: the re-check after the upsert clears one whose
   * erasure raced it.
   */
  async recordKeyFact({ fact }: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void> {
    const { virtualKeyId, organizationId, name, action, occurredAt } = fact;
    const at = new Date(occurredAt);
    const created = action === "created";
    const atWhen = (applies: boolean) => (applies ? at : null);
    const principalAt = atWhen(fact.principalUserId !== null);
    const purposeAt = atWhen(fact.purpose !== null);
    const creatorUserId = created ? fact.actorUserId : null;
    const creatorMarked = PrismaNurturingErasedUserRepository.markExists(creatorUserId);
    const holderMarked = PrismaNurturingErasedUserRepository.markExists(fact.principalUserId);
    await this.#database.$executeRaw`
      INSERT INTO "NurturingVirtualKey" AS known
        ("virtualKeyId", "organizationId", "name", "occurredAt", "keyCreatedAt", "creatorUserId",
         "principalUserId", "principalUserIdAt", "purpose", "purposeAt",
         "disabledAt", "enabledAt", "revokedAt")
      VALUES (${virtualKeyId}, ${organizationId}, ${name},
              (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(created)}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              CASE WHEN ${creatorMarked} THEN NULL ELSE ${creatorUserId} END,
              CASE WHEN ${holderMarked} THEN NULL ELSE ${fact.principalUserId} END,
              (${principalAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              ${fact.purpose},
              (${purposeAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(action === "disabled")}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(action === "enabled")}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(action === "revoked")}::timestamptz AT TIME ZONE 'UTC')::timestamp(3))
      ON CONFLICT ("virtualKeyId") DO UPDATE SET
        "name" = CASE WHEN EXCLUDED."occurredAt" >= known."occurredAt"
                      THEN EXCLUDED."name" ELSE known."name" END,
        "occurredAt" = GREATEST(known."occurredAt", EXCLUDED."occurredAt"),
        "keyCreatedAt" = COALESCE(known."keyCreatedAt", EXCLUDED."keyCreatedAt"),
        "creatorUserId" = CASE WHEN known."keyCreatedAt" IS NULL
                               THEN EXCLUDED."creatorUserId" ELSE known."creatorUserId" END,
        "principalUserId" = CASE WHEN EXCLUDED."principalUserIdAt"
                                      > COALESCE(known."principalUserIdAt", '-infinity'::timestamp)
                                   OR (EXCLUDED."principalUserIdAt" = known."principalUserIdAt"
                                       AND known."principalUserId" IS NULL)
                                 THEN EXCLUDED."principalUserId" ELSE known."principalUserId" END,
        "principalUserIdAt" = GREATEST(known."principalUserIdAt", EXCLUDED."principalUserIdAt"),
        "purpose" = CASE WHEN EXCLUDED."purposeAt"
                              > COALESCE(known."purposeAt", '-infinity'::timestamp)
                         THEN EXCLUDED."purpose" ELSE known."purpose" END,
        "purposeAt" = GREATEST(known."purposeAt", EXCLUDED."purposeAt"),
        "disabledAt" = GREATEST(known."disabledAt", EXCLUDED."disabledAt"),
        "enabledAt" = GREATEST(known."enabledAt", EXCLUDED."enabledAt"),
        "revokedAt" = GREATEST(known."revokedAt", EXCLUDED."revokedAt")
      WHERE known."organizationId" = EXCLUDED."organizationId"
    `;
    await this.#clearErasedNamedByFact({
      virtualKeyId,
      organizationId,
      creatorUserId,
      holderUserId: fact.principalUserId,
    });
  }

  /**
   * The upsert above can read no mark for a person whose erasure has not committed it yet, then
   * store them on a new row, or on a row the erasure's clearing UPDATE had already passed. This
   * separate statement, never in the upsert's transaction, closes that race: if it starts after
   * the mark commits, it sees the mark and clears them; if it starts before, the upsert committed
   * before the mark, so the erasure's clearing UPDATE, which starts after its mark, sees the row.
   * A cleared holder keeps its stamp, as `forgetUser` clears one, so no older fact refills it.
   */
  async #clearErasedNamedByFact({
    virtualKeyId,
    organizationId,
    creatorUserId,
    holderUserId,
  }: Readonly<{
    virtualKeyId: string;
    organizationId: string;
    creatorUserId: string | null;
    holderUserId: string | null;
  }>): Promise<void> {
    if (creatorUserId === null && holderUserId === null) return;
    const namesErased = (column: "creatorUserId" | "principalUserId", userId: string | null) => {
      if (userId === null) return Prisma.sql`false`;
      const marked = PrismaNurturingErasedUserRepository.markExists(userId);
      return Prisma.sql`(${Prisma.raw(`"${column}"`)} = ${userId} AND ${marked})`;
    };
    const creatorErased = namesErased("creatorUserId", creatorUserId);
    const holderErased = namesErased("principalUserId", holderUserId);
    await this.#database.$executeRaw`
      UPDATE "NurturingVirtualKey"
         SET "creatorUserId" = CASE WHEN ${creatorErased} THEN NULL ELSE "creatorUserId" END,
             "principalUserId" = CASE WHEN ${holderErased} THEN NULL ELSE "principalUserId" END
       WHERE "virtualKeyId" = ${virtualKeyId} AND "organizationId" = ${organizationId}
         AND (${creatorErased} OR ${holderErased})`;
  }

  async findKey({
    organizationId,
    virtualKeyId,
  }: Readonly<{
    organizationId: string;
    virtualKeyId: string;
  }>): Promise<NurturingVirtualKey[]> {
    const row = await this.#database.nurturingVirtualKey.findFirst({
      where: { organizationId, virtualKeyId },
    });
    if (!row) return [];
    const key: NurturingVirtualKey = {
      virtualKeyId: row.virtualKeyId,
      organizationId: row.organizationId,
      name: row.name,
      occurredAt: row.occurredAt.getTime(),
      keyCreatedAt: timeOf(row.keyCreatedAt),
      creatorUserId: row.creatorUserId,
      principalUserId: row.principalUserId,
      principalUserIdAt: timeOf(row.principalUserIdAt),
      purpose: storedPurposeSchema.parse(row.purpose),
      purposeAt: timeOf(row.purposeAt),
      disabledAt: timeOf(row.disabledAt),
      enabledAt: timeOf(row.enabledAt),
      revokedAt: timeOf(row.revokedAt),
    };
    return [key];
  }

  /**
   * Marks the account erased first, so a fact folding in from then on stores it nowhere, whatever
   * key it names or when it was stamped; then clears it from the copies naming it. A cleared
   * holder keeps its stamp, as `forgetPersonOnKey` clears one.
   */
  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId });
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erased account holds no key in any organization: its rows go by user, in every one.
      SKIP_TENANT_CHECK: true,
    })}
      UPDATE "NurturingVirtualKey"
         SET "creatorUserId" = CASE WHEN "creatorUserId" = ${userId} THEN NULL
                                    ELSE "creatorUserId" END,
             "principalUserId" = CASE WHEN "principalUserId" = ${userId} THEN NULL
                                      ELSE "principalUserId" END
       WHERE "creatorUserId" = ${userId} OR "principalUserId" = ${userId}`;
  }
}
