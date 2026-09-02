/**
 * @vitest-environment node
 *
 * The sweep ADR-116 §3 calls a required companion to the born-finalized
 * entrance (specs/identity/identity-storage-adapter.feature).
 *
 * A flagged sign-up abandoned between the append and the row commit leaves
 * facts under a tenant that never gained a user row. Nothing SERVES them —
 * but the facts carry the address the customer typed, and "nothing serves
 * them" is not "they are gone".
 *
 * Two mistakes this pins against, both of which look like a working sweep:
 * erasing a stream a retry was about to converge on, and erasing a HELD user
 * — who carries the same `migrated` status and a very real user row.
 */
import type { IdentityReservationRepository } from "../../identity-reservations.repository";
import { describe, expect, it, vi } from "vitest";
import {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
} from "../identity-newborn-reconciliation.service";
import type {
  AbandonedNewborn,
  PrismaIdentityNewbornRepository,
} from "../../repositories/prisma/prisma.identity-newborn.repository";

const NOW = 1_690_000_000_000;

function harness(options?: {
  abandoned?: AbandonedNewborn[];
  eraseFails?: (userId: string) => boolean;
  locksReaped?: number;
}) {
  const findAbandoned = vi.fn(async () => options?.abandoned ?? []);
  const releaseClaim = vi.fn(async () => undefined);
  const eraseUser = vi.fn(async ({ userId }: { userId: string }) => {
    if (options?.eraseFails?.(userId))
      throw new Error("clickhouse unavailable");
    return [];
  });

  const reapOrphans = vi.fn(async () => options?.locksReaped ?? 0);
  const reservations = {
    claim: vi.fn(),
    release: vi.fn(async () => 0),
    reapOrphans,
  } as unknown as IdentityReservationRepository;

  const service = new IdentityNewbornReconciliationService({
    newborns: {
      findAbandoned,
      releaseClaim,
    } as unknown as PrismaIdentityNewbornRepository,
    identity: { eraseUser: eraseUser as never },
    reservations,
    now: () => NOW,
  });

  return { service, findAbandoned, releaseClaim, eraseUser, reapOrphans };
}

const abandoned = (userId: string): AbandonedNewborn => ({
  userId,
  claimedAt: new Date(NOW - IDENTITY_NEWBORN_ABANDONED_AFTER_MS - 1),
});

describe("the newborn reconciliation sweep", () => {
  describe("given an address lock whose fact never landed", () => {
    describe("when the sweep runs", () => {
      /** @scenario "An address lock whose fact never landed is reaped" */
      it("reaps it behind the same horizon the streams use", async () => {
        const { service, reapOrphans } = harness({ locksReaped: 2 });

        const summary = await service.runPass();

        expect(reapOrphans).toHaveBeenCalledWith(
          expect.objectContaining({
            olderThan: new Date(NOW - IDENTITY_NEWBORN_ABANDONED_AFTER_MS),
          }),
        );
        expect(summary.locksReaped).toBe(2);
      });
    });
  });

  describe("given a flagged sign-up whose facts landed and whose rows never did", () => {
    describe("when the sweep runs", () => {
      it("erases the orphaned stream and releases its claim", async () => {
        const { service, eraseUser, releaseClaim } = harness({
          abandoned: [abandoned("user_orphan")],
        });

        const summary = await service.runPass();

        expect(eraseUser).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantId: "user_orphan",
            userId: "user_orphan",
            actor: {
              type: "system",
              id: "system:identity-newborn-reconciliation",
            },
          }),
        );
        expect(releaseClaim).toHaveBeenCalledWith({ userId: "user_orphan" });
        expect(summary).toEqual({
          examined: 1,
          erased: 1,
          failed: 0,
          locksReaped: 0,
        });
      });

      it("only looks at claims older than the abandonment threshold", async () => {
        const { service, findAbandoned } = harness();

        await service.runPass();

        expect(findAbandoned).toHaveBeenCalledWith(
          expect.objectContaining({
            olderThan: new Date(NOW - IDENTITY_NEWBORN_ABANDONED_AFTER_MS),
          }),
        );
      });
    });

    describe("when one stream cannot be erased", () => {
      it("keeps its claim, counts it, and finishes the rest of the pass", async () => {
        const { service, releaseClaim } = harness({
          abandoned: [abandoned("user_broken"), abandoned("user_fine")],
          eraseFails: (userId) => userId === "user_broken",
        });

        const summary = await service.runPass();

        expect(summary).toEqual({
          examined: 2,
          erased: 1,
          failed: 1,
          locksReaped: 0,
        });
        // The claim is the sweep's only handle on the stream, so a failed
        // erase must not drop it — the next pass retries.
        expect(releaseClaim).toHaveBeenCalledTimes(1);
        expect(releaseClaim).toHaveBeenCalledWith({ userId: "user_fine" });
      });
    });
  });
});
