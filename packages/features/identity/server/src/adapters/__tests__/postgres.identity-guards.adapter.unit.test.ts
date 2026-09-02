import {
  IdentityIdentifierNotFoundError,
  MFA_ENROLLED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";
import {
  type IdentityGuardsDatabase,
  PostgresIdentityGuardsAdapter,
} from "../postgres.identity-guards.adapter";

const USER = "user_sam";
const ACTOR = { type: "user", id: USER } as const;

/**
 * A recording stand-in for the composition root's typed client.
 *
 * Every model the seam is allowed to name, and no other — which is the point
 * of the test below as much as of the type: a guard wired to a second client
 * would leave one of these counters at zero while every assertion about the
 * refusal it produced still passed.
 */
function recordingDatabase() {
  const identifierFindMany = vi.fn(async () => [] as unknown[]);
  const identifierFindFirst = vi.fn(async () => null);
  const userFindUnique = vi.fn(async () => null);
  const userFindFirst = vi.fn(async () => null);
  const userUpdateMany = vi.fn(async () => ({ count: 0 }));
  const mfaFindUnique = vi.fn(async () => null);
  const reservationDeleteMany = vi.fn(async () => ({ count: 3 }));
  const queryRaw = vi.fn(async () => [] as unknown[]);

  const database = {
    identifier: { findMany: identifierFindMany, findFirst: identifierFindFirst },
    user: {
      findUnique: userFindUnique,
      findFirst: userFindFirst,
      updateMany: userUpdateMany,
    },
    mfaEnrollment: { findUnique: mfaFindUnique },
    identifierReservation: { deleteMany: reservationDeleteMany },
    $queryRaw: queryRaw,
  } as unknown as IdentityGuardsDatabase;

  return {
    database,
    identifierFindMany,
    userFindFirst,
    mfaFindUnique,
    reservationDeleteMany,
  };
}

describe("PostgresIdentityGuardsAdapter", () => {
  describe("given a process holding one typed Prisma client", () => {
    /** @scenario "The worker composes the identity guards from its own client" */
    it("reads the identifier heads off that client when a guard refuses", async () => {
      const { database, identifierFindMany } = recordingDatabase();
      const { identityGuards } = PostgresIdentityGuardsAdapter.create({ database }).build();

      await expect(
        identityGuards.markPrimary({
          tenantId: USER,
          userId: USER,
          commandId: "cmd_1",
          identifierId: "idf_1",
          occurredAtMs: 1_700_000_000_000,
          actor: ACTOR,
        }),
      ).rejects.toBeInstanceOf(IdentityIdentifierNotFoundError);

      // The refusal alone proves nothing — a guard over an empty stand-in
      // refuses identically. The read is what says WHICH client answered.
      expect(identifierFindMany).toHaveBeenCalledWith({ where: { userId: USER } });
    });

    /** @scenario "The worker composes the identity guards from its own client" */
    it("reads the two-step enrollment off the same client", async () => {
      const { database, mfaFindUnique } = recordingDatabase();
      const { mfaGuards } = PostgresIdentityGuardsAdapter.create({ database }).build();

      const facts = await mfaGuards.enrollMfa({
        tenantId: USER,
        userId: USER,
        commandId: "cmd_2",
        enrollmentId: "enr_1",
        method: "totp",
        occurredAtMs: 1_700_000_000_000,
        actor: ACTOR,
      });

      expect(facts.map((entry) => entry.type)).toEqual([MFA_ENROLLED_EVENT_TYPE]);
      expect(mfaFindUnique).toHaveBeenCalledWith({ where: { userId: USER } });
    });

    /**
     * The address lock is the one collaborator that leaves this seam, because
     * the fold releases through it (ADR-116 §6) and the fold is composed by
     * whoever registers the pipeline.
     */
    /** @scenario "The address lock the guards claim through is the one the fold releases through" */
    it("hands back a lock bound to that client rather than keeping it private", async () => {
      const { database, reservationDeleteMany } = recordingDatabase();
      const { reservations } = PostgresIdentityGuardsAdapter.create({ database }).build();

      const released = await reservations.release({
        userId: USER,
        holdingIdentifierIds: ["idf_live"],
      });

      expect(released).toBe(3);
      expect(reservationDeleteMany).toHaveBeenCalledWith({
        where: { userId: USER, identifierId: { notIn: ["idf_live"] } },
      });
    });
  });
});
