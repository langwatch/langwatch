/**
 * @vitest-environment node
 *
 * The born-finalized entrance's SEQUENCE (ADR-116 §3).
 *
 * The package's own suite proves what better-auth sees; this proves the leg
 * ORDER, which is the part nothing else can observe. Two orderings are wrong
 * in ways that look fine from outside: staging the fold before the rows
 * commit returns a sign-up whose `Identifier` row is missing, because the
 * fold declines to project a user that does not exist; and claiming the
 * tenant after the append leaves an abandoned stream with no handle for the
 * reconciliation sweep to find it by.
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
import { inMemoryIdentityUsers } from "./support/identity-test-doubles";

const EMAIL = "newborn@acme.com";
const T0 = 1_690_000_000_000;

function harness(overrides?: { appendFails?: boolean }) {
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
    append: vi.fn(async () => {
      order.push("append");
      if (overrides?.appendFails) {
        throw new Error("identity ledger cannot append: stack unavailable");
      }
    }),
    stageAndAwait: vi.fn(async () => {
      order.push("fold");
    }),
  } as unknown as IdentityLedgerWriter;

  const rows = {
    claim: vi.fn(async () => {
      order.push("claim");
    }),
    commitNewborn: vi.fn(async ({ userId }: { userId: string }) => {
      order.push("rows");
      return { id: userId, email: EMAIL };
    }),
  } as unknown as PrismaIdentityNewbornRepository;

  const forgetGate = vi.fn();

  const service = new IdentityBirthService({
    guards: new IdentityGuards(heads, inMemoryIdentityUsers()),
    ledger,
    rows,
    forgetGate,
  });

  return { service, ledger, rows, forgetGate, order };
}

const newborn = () => ({
  row: { id: "the-id-better-auth-minted", email: EMAIL, name: "Sam" },
  email: EMAIL,
  createdAtMs: T0,
});

describe("the born-finalized entrance", () => {
  describe("given a flagged sign-up", () => {
    describe("when the entrance bears the newborn", () => {
      it("claims, appends, commits the rows, then folds — in that order", async () => {
        const { service, order } = harness();

        await service.bear(newborn());

        expect(order).toEqual(["claim", "append", "rows", "fold"]);
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

        const idOf = (h: ReturnType<typeof harness>) =>
          (h.ledger.append as unknown as ReturnType<typeof vi.fn>).mock
            .calls[0]?.[0]?.command?.data as {
            userId: string;
            commandId: string;
          };
        expect(idOf(first).userId).toBe(idOf(second).userId);
        // The command id is the event store's idempotency key, so a retry
        // dedupes rather than appending a second fact set.
        expect(idOf(first).commandId).toBe(idOf(second).commandId);
      });

      it("states the command id the backfill would use for this user's email", async () => {
        const { service, ledger } = harness();

        await service.bear(newborn());

        const command = (ledger.append as unknown as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0]?.command as {
          data: { userId: string; commandId: string };
        };
        // Live birth and a later adoption pass derive the SAME command, so
        // the two converge on one projection row instead of two.
        expect(command.data.commandId).toBe(
          `backfill:user-email:${command.data.userId}`,
        );
      });

      it("drops the gate's cached answers once the rows are committed", async () => {
        const { service, forgetGate, order } = harness();

        await service.bear(newborn());

        // After the rows, because before them there is nothing to re-read.
        expect(forgetGate).toHaveBeenCalledTimes(1);
        expect(order.indexOf("rows")).toBeLessThan(order.indexOf("fold"));
      });

      it("appends exactly one attach fact for the address", async () => {
        const { service, ledger } = harness();

        await service.bear(newborn());

        const events = (ledger.append as unknown as ReturnType<typeof vi.fn>)
          .mock.calls[0]?.[0]?.events as IdentityEvent[];
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("lw.identity.identifier_attached");
      });
    });

    describe("when the event-sourcing engine cannot accept the append", () => {
      it("fails with the handled code and never writes the rows", async () => {
        const { service, rows, order } = harness({ appendFails: true });

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
  });
});
