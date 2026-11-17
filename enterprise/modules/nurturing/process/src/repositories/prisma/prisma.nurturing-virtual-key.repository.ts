// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { vkLifecyclePurposeSchema } from "@langwatch/gateway-contract";
import { PrismaRepository, skipTenantCheck } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingVirtualKey,
  NurturingVirtualKeyFact,
} from "../../rules/nurturing-virtual-key.rules.ts";
import type { NurturingVirtualKeyRepository } from "../nurturing-virtual-key.repository.ts";

type NurturingVirtualKeyDatabase = Pick<PrismaClient, "nurturingVirtualKey" | "$executeRaw">;

/** A purpose column holds gateway's own values; anything else is a corrupt row, not a USER. */
const storedPurposeSchema = vkLifecyclePurposeSchema.nullable();

const timeOf = (at: Date | null) => at?.getTime() ?? null;

/** Nurturing's own `NurturingVirtualKey` rows, folded from gateway's lifecycle facts. */
export class PrismaNurturingVirtualKeyRepository
  extends PrismaRepository.for("NurturingVirtualKey")
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
   * One statement whose SET is `foldVirtualKeyFact`: GREATEST skips a null, so a state time only
   * moves later, and a stamped value moves only for a strictly later non-null one. A fact naming
   * another organization for a copied key changes nothing: a key never moves organization.
   */
  async recordKeyFact({ fact }: Readonly<{ fact: NurturingVirtualKeyFact }>): Promise<void> {
    const { virtualKeyId, organizationId, name, action, occurredAt } = fact;
    const at = new Date(occurredAt);
    const created = action === "created";
    const atWhen = (applies: boolean) => (applies ? at : null);
    const principalAt = atWhen(fact.principalUserId !== null);
    const purposeAt = atWhen(fact.purpose !== null);
    await this.#database.$executeRaw`
      INSERT INTO "NurturingVirtualKey" AS known
        ("virtualKeyId", "organizationId", "name", "occurredAt", "keyCreatedAt", "creatorUserId",
         "principalUserId", "principalUserIdAt", "purpose", "purposeAt",
         "disabledAt", "enabledAt", "revokedAt")
      VALUES (${virtualKeyId}, ${organizationId}, ${name},
              (${at}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              (${atWhen(created)}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              ${created ? fact.actorUserId : null},
              ${fact.principalUserId},
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

  /** The stamps stay, so a redelivered older fact naming the account cannot write it back. */
  async forgetUser({ userId }: Readonly<{ userId: string }>): Promise<void> {
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
