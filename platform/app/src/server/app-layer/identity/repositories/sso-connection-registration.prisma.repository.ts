import type {
  SsoConnectionRegistrationRepository,
  SsoConnectionRegistrationSlot,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The connection registration lock. The conflict update is deliberately one
 * statement: claimants serialize on the organization/kind row and receive the
 * actual holder before any registration event is appended.
 */
export class PrismaSsoConnectionRegistrationRepository
  implements SsoConnectionRegistrationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async claim(
    candidate: SsoConnectionRegistrationSlot,
  ): Promise<SsoConnectionRegistrationSlot> {
    const [held] = await this.prisma.$queryRaw<SsoConnectionRegistrationSlot[]>`
      -- @tenancy: this is the organization-scoped pre-event registration lock.
      INSERT INTO "SsoConnectionRegistrationSlot"
        ("organizationId", "kind", "connectionId", "replacesConnectionId", "commandId")
      VALUES (
        ${candidate.organizationId},
        ${candidate.kind},
        ${candidate.connectionId},
        ${candidate.replacesConnectionId},
        ${candidate.commandId}
      )
      ON CONFLICT ("organizationId", "kind") DO UPDATE SET
        "connectionId" = CASE
          WHEN "SsoConnectionRegistrationSlot"."connectionId" = EXCLUDED."connectionId"
            OR EXISTS (
              SELECT 1 FROM "SsoConnection" connection
              WHERE connection."id" = "SsoConnectionRegistrationSlot"."connectionId"
                AND connection."state" IN ('DISCARDED', 'TORN_DOWN')
            )
          THEN EXCLUDED."connectionId"
          ELSE "SsoConnectionRegistrationSlot"."connectionId"
        END,
        "replacesConnectionId" = CASE
          WHEN "SsoConnectionRegistrationSlot"."connectionId" = EXCLUDED."connectionId"
            OR EXISTS (
              SELECT 1 FROM "SsoConnection" connection
              WHERE connection."id" = "SsoConnectionRegistrationSlot"."connectionId"
                AND connection."state" IN ('DISCARDED', 'TORN_DOWN')
            )
          THEN EXCLUDED."replacesConnectionId"
          ELSE "SsoConnectionRegistrationSlot"."replacesConnectionId"
        END,
        "commandId" = CASE
          WHEN "SsoConnectionRegistrationSlot"."connectionId" = EXCLUDED."connectionId"
            OR EXISTS (
              SELECT 1 FROM "SsoConnection" connection
              WHERE connection."id" = "SsoConnectionRegistrationSlot"."connectionId"
                AND connection."state" IN ('DISCARDED', 'TORN_DOWN')
            )
          THEN EXCLUDED."commandId"
          ELSE "SsoConnectionRegistrationSlot"."commandId"
        END,
        "updatedAt" = CASE
          WHEN "SsoConnectionRegistrationSlot"."connectionId" = EXCLUDED."connectionId"
            OR EXISTS (
              SELECT 1 FROM "SsoConnection" connection
              WHERE connection."id" = "SsoConnectionRegistrationSlot"."connectionId"
                AND connection."state" IN ('DISCARDED', 'TORN_DOWN')
            )
          THEN CURRENT_TIMESTAMP
          ELSE "SsoConnectionRegistrationSlot"."updatedAt"
        END
      RETURNING
        "organizationId",
        "kind",
        "connectionId",
        "replacesConnectionId",
        "commandId"
    `;
    if (held === undefined) {
      throw new Error("the SSO registration lock returned no holder");
    }
    return held;
  }
}
