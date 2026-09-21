// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "~/generated/prisma/client";
import type {
  SsoConnectionRegistrationRepository,
  SsoConnectionRegistrationSlot,
} from "./sso-connection-registration.repository";

/**
 * The connection registration lock. An advisory transaction lock serializes
 * every kind for one organization, then the slot rows admit only an exact
 * legacy/replacement pair. A missing projection remains live because its
 * winning event append may still be in flight.
 */
/**
 * Whether a slot still stands in the way, or has been let go.
 *
 * A slot whose connection row is absent counts as LIVE. The row and the slot
 * are written in separate steps, so an absent row is as likely to be a claim
 * half-made as one cleaned up — and treating it as free is what would hand two
 * callers the same slot.
 */
function slotIsLive({
  slot,
  stateByConnection,
}: {
  slot: SsoConnectionRegistrationSlot;
  stateByConnection: Map<string, string>;
}): boolean {
  const state = stateByConnection.get(slot.connectionId);
  return (
    state === undefined || (state !== "DISCARDED" && state !== "TORN_DOWN")
  );
}

/**
 * The slot that refuses this claim, or `null` when the claim may proceed.
 *
 * Two ways to be refused. The candidate's OWN kind is already held by a
 * different live connection — one organization, one direct and one legacy
 * registration. Or the OPPOSITE kind is held by a connection this candidate is
 * not the exact migration counterpart of: a migration is one named pair, not
 * whichever two connections happen to exist.
 */
function slotBlocking({
  candidate,
  slots,
  stateByConnection,
}: {
  candidate: SsoConnectionRegistrationSlot;
  slots: SsoConnectionRegistrationSlot[];
  stateByConnection: Map<string, string>;
}): SsoConnectionRegistrationSlot | null {
  const held = slots.find((slot) => slot.kind === candidate.kind);
  if (
    held &&
    held.connectionId !== candidate.connectionId &&
    slotIsLive({ slot: held, stateByConnection })
  ) {
    return held;
  }

  const opposite = slots.find((slot) => slot.kind !== candidate.kind);
  if (!opposite || !slotIsLive({ slot: opposite, stateByConnection })) {
    return null;
  }
  const exactPair =
    candidate.kind === "direct"
      ? candidate.replacesConnectionId === opposite.connectionId
      : opposite.replacesConnectionId === candidate.connectionId;
  return exactPair ? null : opposite;
}

export class PrismaSsoConnectionRegistrationRepository
  implements SsoConnectionRegistrationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async claim(
    candidate: SsoConnectionRegistrationSlot,
  ): Promise<SsoConnectionRegistrationSlot> {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`
        -- @tenancy: organization-scoped advisory lock keyed by the bound organization id
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

      const blocking = slotBlocking({ candidate, slots, stateByConnection });
      if (blocking) return blocking;

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
