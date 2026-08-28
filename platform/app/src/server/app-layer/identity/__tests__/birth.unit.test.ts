/**
 * @vitest-environment node
 *
 * The born-finalized entrance's SEQUENCE (ADR-116 §3).
 *
 * The package's own suite proves what better-auth sees; this proves the leg
 * ORDER, which is the part nothing else can observe. Three orderings are wrong
 * in ways that look fine from outside: staging after the rows commit means an
 * unavailable engine fails a sign-up that already created a user; claiming the
 * tenant after the facts reach the engine leaves an abandoned stream with no
 * handle for the reconciliation sweep to find it by; and adopting whatever
 * user already stands at the pinned id hands the signer somebody else's
 * account.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import { IdentityGuards } from "@langwatch/identity-server";
import { IdentityEngineUnavailableError } from "@langwatch/identity-server/better-auth";
import { describe, expect, it, vi } from "vitest";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import { IdentityBirthService } from "../birth";
import type { IdentityLedgerWriter } from "../ledger";
import type { PrismaIdentityNewbornRepository } from "../repositories/identity-newborn.prisma.repository";
import {
  inMemoryIdentityReservations,
  inMemoryIdentityUsers,
} from "./support/identity-test-doubles";

const EMAIL = "newborn@acme.com";
const T0 = 1_690_000_000_000;

function harness(overrides?: {
  stagingFails?: boolean;
  foldWaitFails?: boolean;
  occupiedBy?: string;
}) {
  const order: string[] = [];
  const heads = {
    findUserHashKey: async () => "key_material",
    findHeads: async ({ userId }: { userId: string }) => ({
      userId,
      identifiers: {},
    }),
    findActiveIdentifierByValue: async () => null,
    findIdentifier: async () => null,
    findIdentifierIdForAccount: async () => null,
  };

  const ledger = {
    stage: vi.fn(async () => {
      order.push("stage");
      if (overrides?.stagingFails) {
        throw new Error("identity ledger cannot stage: stack unavailable");
      }
    }),
    awaitFold: vi.fn(async () => {
      order.push("fold");
      if (overrides?.foldWaitFails) {
        throw new Error("the projection could not be read");
      }
    }),
  } as unknown as IdentityLedgerWriter;

  const rows = {
    findUserAtPinnedId: vi.fn(async () =>
      overrides?.occupiedBy === undefined ? null : { id: overrides.occupiedBy },
    ),
    claim: vi.fn(async () => {
      order.push("claim");
    }),
    commitNewborn: vi.fn(async ({ userId }: { userId: string }) => {
      order.push("rows");
      return { id: userId, email: EMAIL };
    }),
  } as unknown as PrismaIdentityNewbornRepository;

  const reservations = inMemoryIdentityReservations();
  const forgetGate = vi.fn();

  const service = new IdentityBirthService({
    guards: new IdentityGuards(heads, inMemoryIdentityUsers(), reservations),
    ledger,
    rows,
    reservations,
    forgetGate,
  });

  return { service, ledger, rows, reservations, forgetGate, order };
}

const newborn = () => ({
  row: { id: "the-id-better-auth-minted", email: EMAIL, name: "Sam" },
  email: EMAIL,
  createdAtMs: T0,
});

const stagedCommand = (h: ReturnType<typeof harness>) =>
  (h.ledger.stage as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    ?.command as { data: { userId: string; commandId: string } };

describe("the born-finalized entrance", () => {
  describe("given a flagged sign-up", () => {
    describe("when the entrance bears the newborn", () => {
      it("claims, stages, commits the rows, then observes the fold — in that order", async () => {
        const { service, order } = harness();

        await service.bear(newborn());

        expect(order).toEqual(["claim", "stage", "rows", "fold"]);
      });

      it("hands better-auth back the PINNED id, not the one it minted", async () => {
        const { service, rows } = harness();

        const written = await service.bear(newborn());

        const pinned = (
          rows.commitNewborn as unknown as ReturnType<typeof vi.fn>
        ).mock.calls[0]?.[0]?.userId as string;
        expect(written.id).toBe(pinned);
        expect(written.id).not.toBe("the-id-better-auth-minted");
      });

      it("derives the same ids for the same address, so a retry converges", async () => {
        const first = harness();
        const second = harness();

        await first.service.bear(newborn());
        await second.service.bear(newborn());

        expect(stagedCommand(first).data.userId).toBe(
          stagedCommand(second).data.userId,
        );
        // The command id is the event store's idempotency key, so a retry
        // dedupes rather than appending a second fact set.
        expect(stagedCommand(first).data.commandId).toBe(
          stagedCommand(second).data.commandId,
        );
      });

      it("states the command id the backfill would use for this user's email", async () => {
        const { service, ...rest } = harness();
        const h = { service, ...rest };

        await service.bear(newborn());

        // Live birth and a later adoption pass derive the SAME command, so
        // the two converge on one projection row instead of two.
        expect(stagedCommand(h).data.commandId).toBe(
          `backfill:user-email:${stagedCommand(h).data.userId}`,
        );
      });

      it("drops the gate's cached answers once the rows are committed", async () => {
        const { service, forgetGate, order } = harness();

        await service.bear(newborn());

        // After the rows, because before them there is nothing to re-read.
        expect(forgetGate).toHaveBeenCalledTimes(1);
        expect(order.indexOf("rows")).toBeLessThan(order.indexOf("fold"));
      });

      it("stages exactly one attach fact for the address", async () => {
        const { service, ledger } = harness();

        await service.bear(newborn());

        const events = (ledger.awaitFold as unknown as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0]?.events as IdentityEvent[];
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("lw.identity.identifier_attached");
      });

      /** @scenario "A flagged sign-up is refused when its pinned id is already someone's" */
      it("takes the address lock before the facts reach the engine", async () => {
        const { service, reservations, order } = harness();

        await service.bear(newborn());

        expect([...reservations.held.keys()]).toEqual([EMAIL]);
        expect(order.indexOf("claim")).toBeLessThan(order.indexOf("stage"));
      });
    });

    describe("when the pinned id already belongs to somebody", () => {
      /** @scenario "A flagged sign-up is refused when its pinned id is already someone's" */
      it("refuses with the collision code and states nothing", async () => {
        const { service, rows, order } = harness({ occupiedBy: "user_sam" });

        await expect(service.bear(newborn())).rejects.toMatchObject({
          code: "identity_email_in_use",
        });

        expect(rows.claim).not.toHaveBeenCalled();
        expect(rows.commitNewborn).not.toHaveBeenCalled();
        expect(order).toEqual([]);
      });
    });

    describe("when the event-sourcing engine cannot take the command", () => {
      it("fails with the handled code and never writes the rows", async () => {
        const { service, rows, order } = harness({ stagingFails: true });

        await expect(service.bear(newborn())).rejects.toMatchObject({
          code: "identity_engine_unavailable",
          fault: "platform",
        });
        await expect(service.bear(newborn())).rejects.toBeInstanceOf(
          IdentityEngineUnavailableError,
        );

        expect(rows.commitNewborn).not.toHaveBeenCalled();
        // The claim outlives the failure on purpose: it is the only handle
        // the reconciliation sweep has on a stream whose rows never landed.
        expect(order).toContain("claim");
      });
    });

    describe("when the rows commit and the fold cannot be observed", () => {
      /** @scenario "A newborn whose rows committed is never failed by the fold wait" */
      it("returns the newborn rather than leaving a finalized user nothing owns", async () => {
        const { service, order } = harness({ foldWaitFails: true });

        const written = await service.bear(newborn());

        expect(written.email).toBe(EMAIL);
        expect(order).toEqual(["claim", "stage", "rows", "fold"]);
      });
    });
  });
});
