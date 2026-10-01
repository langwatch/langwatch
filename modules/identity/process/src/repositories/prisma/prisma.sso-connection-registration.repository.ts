import type { PrismaClient } from "@langwatch/prisma-client/generated";

import { findBlockingRegistrationSlots } from "../../rules/sso-connection-registration.rules.ts";
import {
  SSO_CONNECTION_REGISTRATION_KINDS,
  SsoConnectionRegistrationRepository,
  type SsoConnectionRegistrationSlot,
} from "../sso-connection-registration.repository.ts";

export type PrismaSsoConnectionRegistrationDatabase = Pick<
  PrismaClient,
  "ssoConnection" | "ssoConnectionRegistrationSlot" | "$transaction"
>;

/**
 * An advisory transaction lock serializes every registration for one
 * organization, then the slot rows admit only an exact legacy/replacement
 * pair. Terminal connections free their slot; a missing row does not.
 */
export class PrismaSsoConnectionRegistrationRepository extends SsoConnectionRegistrationRepository {
  static create(
    database: PrismaSsoConnectionRegistrationDatabase,
  ): PrismaSsoConnectionRegistrationRepository {
    return new PrismaSsoConnectionRegistrationRepository(database);
  }

  private constructor(private readonly prisma: PrismaSsoConnectionRegistrationDatabase) {
    super();
  }

  async claim(candidate: SsoConnectionRegistrationSlot): Promise<SsoConnectionRegistrationSlot> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        -- @tenancy: organization-scoped advisory lock keyed by the bound organization id
        SELECT pg_advisory_xact_lock(hashtextextended(${candidate.organizationId}, 1397968719))
      `;
      const rows = await tx.ssoConnectionRegistrationSlot.findMany({
        where: { organizationId: candidate.organizationId },
        select: {
          organizationId: true,
          kind: true,
          connectionId: true,
          replacesConnectionId: true,
          commandId: true,
        },
      });
      const slots = rows.flatMap((row): SsoConnectionRegistrationSlot[] => {
        const kind = SSO_CONNECTION_REGISTRATION_KINDS.find((known) => known === row.kind);
        return kind ? [{ ...row, kind }] : [];
      });
      const states = await tx.ssoConnection.findMany({
        where: { id: { in: slots.map((slot) => slot.connectionId) } },
        select: { id: true, state: true },
      });
      const stateByConnection = new Map(states.map((row) => [row.id, row.state]));

      const [blocking] = findBlockingRegistrationSlots({ candidate, slots, stateByConnection });
      if (blocking) return blocking;

      await tx.ssoConnectionRegistrationSlot.upsert({
        where: {
          organizationId_kind: { organizationId: candidate.organizationId, kind: candidate.kind },
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
