import type {
  SsoConnectionRegistrationRepository,
  SsoConnectionRegistrationSlot,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The connection registration lock. An advisory transaction lock serializes
 * every kind for one organization, then the slot rows admit only an exact
 * legacy/replacement pair. A missing projection remains live because its
 * winning event append may still be in flight.
 */
export class PrismaSsoConnectionRegistrationRepository
  implements SsoConnectionRegistrationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async claim(
    candidate: SsoConnectionRegistrationSlot,
  ): Promise<SsoConnectionRegistrationSlot> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${candidate.organizationId}, 1397968719)
        ) IS NULL AS locked
      `;

      const slots = await tx.$queryRaw<SsoConnectionRegistrationSlot[]>`
        SELECT
          "organizationId", "kind", "connectionId",
          "replacesConnectionId", "commandId"
        FROM "SsoConnectionRegistrationSlot"
        WHERE "organizationId" = ${candidate.organizationId}
      `;
      const states = await tx.ssoConnection.findMany({
        where: { id: { in: slots.map((slot) => slot.connectionId) } },
        select: { id: true, state: true },
      });
      const stateByConnection = new Map(
        states.map((connection) => [connection.id, connection.state]),
      );
      const isLive = (slot: SsoConnectionRegistrationSlot): boolean => {
        const state = stateByConnection.get(slot.connectionId);
        return state === undefined || (state !== "DISCARDED" && state !== "TORN_DOWN");
      };

      const held = slots.find((slot) => slot.kind === candidate.kind);
      if (held && held.connectionId !== candidate.connectionId && isLive(held)) {
        return held;
      }

      const opposite = slots.find((slot) => slot.kind !== candidate.kind);
      if (opposite && isLive(opposite)) {
        const exactPair =
          candidate.kind === "direct"
            ? candidate.replacesConnectionId === opposite.connectionId
            : opposite.replacesConnectionId === candidate.connectionId;
        if (!exactPair) return opposite;
      }

      await tx.ssoConnectionRegistrationSlot.upsert({
        where: {
          organizationId_kind: {
            organizationId: candidate.organizationId,
            kind: candidate.kind,
          },
        },
        create: candidate,
        update: {
          connectionId: candidate.connectionId,
          replacesConnectionId: candidate.replacesConnectionId,
          commandId: candidate.commandId,
        },
      });
      return candidate;
    });
  }
}
