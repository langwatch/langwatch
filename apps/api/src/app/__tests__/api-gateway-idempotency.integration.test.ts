/**
 * The `Idempotency-Key` seam on the gateway application this process composes.
 *
 * What this pins is the WIRING, which is the half a unit test of the ledger
 * cannot see: `composeApiGateway` is handed the port
 * `composeApiIdempotency` builds, the `GatewayApp` the six tRPC namespaces and
 * the two REST families all read exposes it as `app.idempotency`, and the three
 * keyed creates dispatch through THAT runner rather than through one of their
 * own. Everything below the port is real — the moved receipt protocol, this
 * process's own cipher — and the fakes are at the ports: a receipt store with
 * the unique index the protocol decides on, and a project directory.
 *
 * The absence is pinned beside it, because an absence nobody can observe is
 * indistinguishable from a stub: a process that composed no ledger refuses the
 * keyed create by name instead of executing it unguarded, which is the failure
 * the header exists to prevent.
 *
 * @see apps/api/src/app/api-idempotency.composition.ts
 * @see specs/ai-gateway/idempotency.feature
 */
// @vitest-environment node
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { describe, expect, it, vi } from "vitest";

import { composeApiGateway } from "../api-gateway.composition";
import { composeApiIdempotency } from "../api-idempotency.composition";

const PROJECT_ID = "project-1";
const KEY = "order-4711";
/** 32 bytes of hex, which is what the cipher refuses anything else for. */
const CREDENTIALS_SECRET = "a".repeat(64);

/**
 * A receipt store with the unique index over (scopeId, key), and nothing else.
 *
 * That index is the only thing that actually decides a race, so a double
 * without it would let this suite pass while proving nothing.
 */
function testReceiptStore() {
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 1;
  const byId = (id: string) => [...rows.values()].find((row) => row.id === id);

  const idempotencyReceipt = {
    create: vi.fn(async (input: { data: Record<string, unknown> }) => {
      const unique = `${input.data.scopeId as string}:${input.data.key as string}`;
      if (rows.has(unique)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const id = `receipt_${nextId++}`;
      rows.set(unique, { ...input.data, id, responseStatus: null, responseBody: null });
      return { id };
    }),
    findUnique: vi.fn(
      async (input: { where: { scopeId_key: { scopeId: string; key: string } } }) =>
        rows.get(`${input.where.scopeId_key.scopeId}:${input.where.scopeId_key.key}`) ?? null,
    ),
    updateMany: vi.fn(
      async (input: { where: { id: string; claimId?: string }; data: Record<string, unknown> }) => {
        const row = byId(input.where.id);
        if (!row) return { count: 0 };
        if (input.where.claimId !== undefined && row.claimId !== input.where.claimId) {
          return { count: 0 };
        }
        Object.assign(row, input.data);
        return { count: 1 };
      },
    ),
    deleteMany: vi.fn(async (input: { where: { id: string } }) => {
      const found = [...rows.entries()].find(([, row]) => row.id === input.where.id);
      if (!found) return { count: 0 };
      rows.delete(found[0]);
      return { count: 1 };
    }),
  };

  return { idempotencyReceipt, rows };
}

/** The gateway composition's collaborators, none of which this seam reaches. */
function composeGatewayWith(idempotency: ReturnType<typeof composeApiIdempotency>) {
  const receipts = testReceiptStore();
  return {
    receipts,
    gateway: composeApiGateway({
      prisma: receipts as unknown as PrismaClient,
      authz: { hasPermission: async () => true } as unknown as AuthzService,
      projects: {} as unknown as ProjectService,
      evaluators: {} as unknown as EvaluatorService,
      monitors: {} as unknown as MonitorService,
      clickhouse: null,
      virtualKeyPepper: undefined,
      ...(idempotency ? { idempotency: idempotency.gateway } : {}),
    }),
  };
}

/**
 * What a call refused with, read as the two fields a caller branches on.
 *
 * A helper rather than an inline `.catch`, so a call that DOES resolve fails
 * the test by name instead of silently satisfying an assertion on `undefined`.
 */
async function refusalFrom(
  call: () => Promise<unknown>,
): Promise<{ code?: string; meta?: { reason?: string } }> {
  try {
    await call();
  } catch (error) {
    return error as { code?: string; meta?: { reason?: string } };
  }
  throw new Error("the call was expected to refuse, and it answered instead");
}

/** This process's ledger, over the store below it and its own cipher. */
function composeLedgerOver(receipts: ReturnType<typeof testReceiptStore>) {
  return composeApiIdempotency({
    database: receipts as unknown as PrismaClient,
    encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
  });
}

describe("the gateway application's Idempotency-Key runner", () => {
  describe("given a process that composed a receipt ledger", () => {
    /** @scenario "Retrying a create with the same key replays the first response" */
    it("executes a keyed create once and replays its stored answer", async () => {
      const receipts = testReceiptStore();
      const { gateway } = composeGatewayWith(composeLedgerOver(receipts));
      const create = vi.fn(async () => ({
        status: 201,
        body: { id: "vk_1", secret: "shown once" },
      }));
      const request = {
        operation: "gateway.v1.virtual-keys.create",
        scopeId: PROJECT_ID,
        key: KEY,
        validatedBody: { name: "billing" },
      };

      const first = await gateway.app.idempotency({ ...request, handler: create });
      const replay = await gateway.app.idempotency({
        ...request,
        handler: vi.fn(async () => ({ status: 201, body: { id: "vk_2", secret: "another" } })),
      });

      expect(first).toMatchObject({ isReplayed: false, status: 201 });
      expect(replay).toEqual({
        isReplayed: true,
        status: 201,
        serializedBody: JSON.stringify({ id: "vk_1", secret: "shown once" }),
      });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("writes the stored response as ciphertext rather than as readable JSON", async () => {
      const receipts = testReceiptStore();
      const { gateway } = composeGatewayWith(composeLedgerOver(receipts));

      await gateway.app.idempotency({
        operation: "gateway.v1.virtual-keys.create",
        scopeId: PROJECT_ID,
        key: KEY,
        validatedBody: { name: "billing" },
        handler: async () => ({ status: 201, body: { secret: "vk-lw-shown-once" } }),
      });

      const stored = [...receipts.rows.values()][0]?.responseBody;
      expect(typeof stored).toBe("string");
      // The one-time secret is what a replay hands back, so it transits this
      // column; reading it out of the row must not be possible without the key.
      expect(stored as string).not.toContain("vk-lw-shown-once");
    });

    /** @scenario "A retry sent while the original is still running is refused" */
    it("refuses a concurrent retry under the same key rather than creating twice", async () => {
      const receipts = testReceiptStore();
      const { gateway } = composeGatewayWith(composeLedgerOver(receipts));
      let runs = 0;
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const request = {
        operation: "gateway.v1.virtual-keys.create",
        scopeId: PROJECT_ID,
        key: KEY,
        validatedBody: { name: "billing" },
      };

      const slow = gateway.app.idempotency({
        ...request,
        handler: async () => {
          runs++;
          await held;
          return { status: 201, body: { id: "vk_1" } };
        },
      });
      const refusal = await refusalFrom(() =>
        gateway.app.idempotency({
          ...request,
          handler: async () => {
            runs++;
            return { status: 201, body: { id: "vk_2" } };
          },
        }),
      );
      release?.();
      await slow;

      expect(refusal.code).toBe("idempotency_error");
      expect(refusal.meta?.reason).toBe("in_progress");
      expect(runs).toBe(1);
    });
  });

  describe("given a process that composed no receipt ledger", () => {
    it("refuses a keyed create by name rather than executing it unguarded", async () => {
      const { gateway } = composeGatewayWith(undefined);
      const create = vi.fn(async () => ({ status: 201, body: { id: "vk_1" } }));

      const refusal = await refusalFrom(() =>
        gateway.app.idempotency({
          operation: "gateway.v1.virtual-keys.create",
          scopeId: PROJECT_ID,
          key: KEY,
          validatedBody: { name: "billing" },
          handler: create,
        }),
      );

      expect(refusal.code).toBe("service_unavailable");
      expect(create).not.toHaveBeenCalled();
    });

    it("is not composed when the process holds a database but no cipher", () => {
      expect(
        composeApiIdempotency({
          database: testReceiptStore() as unknown as PrismaClient,
          encryption: undefined,
        }),
      ).toBeUndefined();
      expect(
        composeApiIdempotency({
          database: undefined,
          encryption: AesGcmSecretEncryptionAdapter.create({ key: CREDENTIALS_SECRET }),
        }),
      ).toBeUndefined();
    });
  });
});
