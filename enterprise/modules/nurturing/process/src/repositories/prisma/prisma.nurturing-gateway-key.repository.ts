// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { virtualKeyPurposeSchema } from "@langwatch/gateway-contract";
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

import {
  erasedUserHashOf,
  type NurturingVirtualKey,
  type NurturingVirtualKeyFact,
} from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingVirtualKeyRepository } from "../nurturing-gateway-key.repository.ts";

type NurturingVirtualKeyDatabase = Pick<
  PrismaClient,
  "nurturingVirtualKey" | "nurturingErasedUser" | "$executeRaw"
>;

/** A purpose column holds gateway's own values; anything else is a corrupt row, not a USER. */
const storedPurposeSchema = virtualKeyPurposeSchema.nullable();

const timeOf = (at: Date | null) => at?.getTime() ?? null;

/** Whether an id is marked erased, in SQL: the check and the write it guards are one statement. */
const isErased = (userId: string | null) =>
  userId === null
    ? Prisma.sql`false`
    : Prisma.sql`EXISTS (SELECT 1 FROM "NurturingErasedUser"
                          WHERE "userIdHash" = ${erasedUserHashOf(userId)})`;

/**
 * Nurturing's own `NurturingVirtualKey` rows, folded from gateway's lifecycle facts, and the
 * `NurturingErasedUser` marks that keep an erased account off them.
 */
export class PrismaNurturingVirtualKeyRepository
  extends PrismaRepository.for("NurturingVirtualKey", "NurturingErasedUser")
  implements NurturingVirtualKeyRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingVirtualKeyDatabase }>): PrismaNurturingVirtualKeyRepository {
    return new PrismaNurturingVirtualKeyRepository(prisma);
  }

  readonly #database: NurturingVirtualKeyDatabase;

  private constructor(prisma: NurturingVirtualKeyDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  /**
   * An upsert whose SET is `foldVirtualKeyFact`: GREATEST skips a null, so a state time only
   * moves later, and a stamped value moves only for a strictly later non-null one. A fact naming
   * another organization for a copied key changes nothing: a key never moves organization. An
   * erased creator or holder reads null with no stamp, as `withoutErasedPeople` folds it; a
   * re-check after the upsert clears one whose erasure raced it.
   */
  async recordKeyFact({ fact }: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void> {
    const { virtualKeyId, organizationId, name, action, occurredAt } = fact;
    const at = new Date(occurredAt);
    const created = action === "created";
    const atWhen = (applies: boolean) => (applies ? at : null);
    const principalAt = atWhen(fact.principalUserId !== null);
    const purposeAt = atWhen(fact.purpose !== null);
    const creatorUserId = created ? fact.actorUserId : null;
    const principalErased = isErased(fact.principalUserId);
    await this.#database.$executeRaw`
      INSERT INTO "NurturingVirtualKey" AS known
        ("virtualKeyId", "organizationId", "name", "occurredAt", "keyCreatedAt", "creatorUserId",
         "principalUserId", "principalUserIdAt", "purpose", "purposeAt",
         "disabledAt", "enabledAt", "revokedAt")
      VALUES (${virtualKeyId}, ${organizationId}, ${name},
              (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(created)}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              CASE WHEN ${isErased(creatorUserId)} THEN NULL ELSE ${creatorUserId} END,
              CASE WHEN ${principalErased} THEN NULL ELSE ${fact.principalUserId} END,
              CASE WHEN ${principalErased} THEN NULL
                   ELSE (${principalAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3) END,
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
    const namesErased = (column: "creatorUserId" | "principalUserId", userId: string | null) =>
      userId === null
        ? Prisma.sql`false`
        : Prisma.sql`(${Prisma.raw(`"${column}"`)} = ${userId} AND ${isErased(userId)})`;
    const creatorErased = namesErased("creatorUserId", creatorUserId);
    const holderErased = namesErased("principalUserId", holderUserId);
    await this.#database.$executeRaw`
      UPDATE "NurturingVirtualKey"
         SET "creatorUserId" = CASE WHEN ${creatorErased} THEN NULL ELSE "creatorUserId" END,
             "principalUserId" = CASE WHEN ${holderErased} THEN NULL ELSE "principalUserId" END,
             "principalUserIdAt" = CASE WHEN ${holderErased} THEN NULL
                                        ELSE "principalUserIdAt" END
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
   * holder's stamp moves to now, as `forgetPersonOnKey` does.
   */
  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erasure spans every organization: the mark is the account's alone.
      SKIP_TENANT_CHECK: true,
    })}
      INSERT INTO "NurturingErasedUser" ("userIdHash")
      VALUES (${erasedUserHashOf(userId)})
      ON CONFLICT ("userIdHash") DO NOTHING`;
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erased account holds no key in any organization: its rows go by user, in every one.
      SKIP_TENANT_CHECK: true,
    })}
      UPDATE "NurturingVirtualKey"
         SET "creatorUserId" = CASE WHEN "creatorUserId" = ${userId} THEN NULL
                                    ELSE "creatorUserId" END,
             "principalUserId" = CASE WHEN "principalUserId" = ${userId} THEN NULL
                                      ELSE "principalUserId" END,
             "principalUserIdAt" = CASE WHEN "principalUserId" = ${userId}
                                        THEN GREATEST("principalUserIdAt",
                                                      (now() AT TIME ZONE 'UTC')::timestamp(3))
                                        ELSE "principalUserIdAt" END
       WHERE "creatorUserId" = ${userId} OR "principalUserId" = ${userId}`;
  }
}
