/**
 * @vitest-environment node
 *
 * Pins both halves of the bargain #8097 struck on the personal-API-key
 * router: the audit write is awaited, AND its failure is caught.
 *
 * `create`, `update` and `revoke` dispatched their audit write with a bare
 * `void auditLog(...)`, so the row was still in flight — and could be lost
 * outright — when the mutation answered. They now await it, and catch.
 *
 * The catch is not decoration, which is why it is pinned here rather than
 * left to code review. All three audit calls sit inside the handler's
 * `try { ... } catch (error) { mapApiKeyHandledError(error) }`. Awaiting
 * without catching would route an audit-write failure into that mapper,
 * which turns it into an INTERNAL_SERVER_ERROR — so a lost audit row would
 * become a *destroyed credential*: the key is already created or revoked in
 * the database, and the plaintext token this response shows exactly once
 * goes out with the error. `await` makes the row durable; `.catch` keeps
 * that durability from costing the caller their key. Delete either one
 * alone and this file goes red, in opposite directions.
 *
 * Ordering is the hard half to observe. A "is the row in the database yet"
 * assertion cannot see it at the tRPC boundary, because the audit middleware
 * (`src/server/api/trpc.ts`) awaits a write of its own after the handler
 * returns, which gives an unawaited router write a wide window to land
 * anyway. So these cases watch the seam directly: hold the audit write open
 * and the mutation must not answer. Revert an `await` to `void` and it
 * answers immediately, which is precisely the defect.
 *
 * No sleeps, no polling, no fake timers. The audit promise is released by
 * hand, and the one yield is a single macrotask tick — every microtask the
 * handler could still be waiting on has drained by the time it fires, so a
 * mutation that has not settled by then is genuinely blocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { apiKeyRouter } from "../apiKey";

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    skipPermissionCheck:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * One control for both halves of the bargain: `holdAction` leaves the write
 * pending (the ordering cases), `rejectAction` fails it (the `.catch` cases).
 *
 * Only the router's own write is ever touched. The tRPC middleware audits
 * every mutation under its procedure path and runs *after* the handler, so
 * holding that one would block the caller no matter which way the router
 * dispatches — the test would pass against the unfixed code. The two are
 * told apart by action: the router names `apiKey.create`, the middleware
 * names the bare procedure path this caller is built on (`create`).
 */
const { audit } = vi.hoisted(() => ({
  audit: {
    holdAction: null as string | null,
    release: null as null | (() => void),
    rejectAction: null as string | null,
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (entry: { action: string }) => {
    if (entry.action === audit.rejectAction) {
      return Promise.reject(
        new Error(`audit write refused for ${entry.action}`),
      );
    }
    if (entry.action !== audit.holdAction) return Promise.resolve();
    return new Promise<void>((resolve) => {
      audit.release = resolve;
    });
  },
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const API_KEY_ID = "ak_1";
const CREATED_AT = new Date("2026-01-01T00:00:00.000Z");

const service = vi.hoisted(() => ({
  ensureCallerIsOrgMember: vi.fn(),
  isOrgAdmin: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  revoke: vi.fn(),
}));

// The service is a collaborator here, not the unit: these cases are about
// when the router answers relative to its audit write, so the work the
// answer depends on resolves immediately and the audit write is the only
// thing left that can hold the mutation open.
vi.mock("~/server/api-key/api-key.service", () => ({
  ApiKeyService: { create: () => service },
}));

function buildCaller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  return apiKeyRouter.createCaller(ctx);
}

/**
 * Yields once to the macrotask queue. Microtasks run to exhaustion first, so
 * anything the handler is merely `await`ing on an already-settled promise has
 * finished by the time this returns; anything still pending is waiting on a
 * promise nobody has resolved.
 */
const drainMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

/** Tracks settlement without swallowing the eventual value or error. */
function watch<T>(promise: Promise<T>) {
  const state = { settled: false };
  const observed = promise.then(
    (value) => {
      state.settled = true;
      return value;
    },
    (error) => {
      state.settled = true;
      throw error;
    },
  );
  return { state, observed };
}

describe("apiKey router — the audit row is durable before the caller is told", () => {
  let caller: ReturnType<typeof apiKeyRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    audit.holdAction = null;
    audit.release = null;
    audit.rejectAction = null;
    service.ensureCallerIsOrgMember.mockResolvedValue(undefined);
    service.isOrgAdmin.mockResolvedValue(true);
    service.create.mockResolvedValue({
      token: "sk-lw-test-token",
      apiKey: { id: API_KEY_ID, name: "Test Key", createdAt: CREATED_AT },
    });
    service.update.mockResolvedValue({
      id: API_KEY_ID,
      name: "Renamed Key",
      permissionMode: "all",
    });
    service.revoke.mockResolvedValue(undefined);
    caller = buildCaller();
  });

  describe("create", () => {
    it("does not answer with the token while the audit write is still open", async () => {
      audit.holdAction = "apiKey.create";

      const { state, observed } = watch(
        caller.create({
          organizationId: ORG_ID,
          name: "Test Key",
          permissionMode: "all",
          keyType: "personal",
          bindings: [],
        }),
      );

      await drainMicrotasks();
      expect(service.create).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      audit.release?.();
      const result = await observed;
      expect(result?.token).toBe("sk-lw-test-token");
      expect(result?.apiKey.id).toBe(API_KEY_ID);
    });

    // The key exists in the database by the time the audit write is
    // attempted. Letting that failure reach `mapApiKeyHandledError` would
    // answer with an INTERNAL_SERVER_ERROR and take the only copy of the
    // token with it — the caller would be left with a live credential they
    // cannot use and did not know they own.
    it("still returns the token create shows exactly once when the audit write fails", async () => {
      audit.rejectAction = "apiKey.create";

      const result = await caller.create({
        organizationId: ORG_ID,
        name: "Test Key",
        permissionMode: "all",
        keyType: "personal",
        bindings: [],
      });

      expect(result?.token).toBe("sk-lw-test-token");
      expect(result?.apiKey.id).toBe(API_KEY_ID);
    });
  });

  describe("update", () => {
    it("does not answer while the audit write is still open", async () => {
      audit.holdAction = "apiKey.update";

      const { state, observed } = watch(
        caller.update({
          organizationId: ORG_ID,
          apiKeyId: API_KEY_ID,
          name: "Renamed Key",
        }),
      );

      await drainMicrotasks();
      expect(service.update).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      audit.release?.();
      expect(await observed).toMatchObject({ id: API_KEY_ID });
    });

    // The key's new name and permissions are already written. An uncaught
    // audit failure would report the update as failed, so the caller would
    // retry or believe their change was lost while it is in fact live.
    it("still reports the update that already happened when the audit write fails", async () => {
      audit.rejectAction = "apiKey.update";

      expect(
        await caller.update({
          organizationId: ORG_ID,
          apiKeyId: API_KEY_ID,
          name: "Renamed Key",
        }),
      ).toMatchObject({ id: API_KEY_ID, name: "Renamed Key" });
    });
  });

  describe("revoke", () => {
    it("does not answer while the audit write is still open", async () => {
      audit.holdAction = "apiKey.revoke";

      const { state, observed } = watch(
        caller.revoke({ organizationId: ORG_ID, apiKeyId: API_KEY_ID }),
      );

      await drainMicrotasks();
      expect(service.revoke).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      audit.release?.();
      expect(await observed).toEqual({ success: true });
    });

    // The key is already dead. An uncaught audit failure would tell the
    // caller the revoke failed, inviting them to retry a kill that already
    // happened — or worse, to assume the credential is still live.
    it("still reports the revoke that already happened when the audit write fails", async () => {
      audit.rejectAction = "apiKey.revoke";

      expect(
        await caller.revoke({ organizationId: ORG_ID, apiKeyId: API_KEY_ID }),
      ).toEqual({ success: true });
      expect(service.revoke).toHaveBeenCalledTimes(1);
    });
  });
});
