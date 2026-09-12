/**
 * @vitest-environment node
 *
 * Pins the ordering half of #8097 on the personal-API-key router.
 *
 * `create`, `update` and `revoke` dispatched their audit write with a bare
 * `void auditLog(...)`, so the row was still in flight — and could be lost
 * outright — when the mutation answered. They now await it.
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
 * Only the router's own write is held open. The tRPC middleware audits every
 * mutation under its procedure path and runs *after* the handler, so holding
 * that one open would block the caller no matter which way the router
 * dispatches — the test would pass against the unfixed code. The two are
 * told apart by action: the router names `apiKey.create`, the middleware
 * names the bare procedure path this caller is built on (`create`).
 */
const { held } = vi.hoisted(() => ({
  held: {
    action: null as string | null,
    release: null as null | (() => void),
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (entry: { action: string }) => {
    if (entry.action !== held.action) return Promise.resolve();
    return new Promise<void>((resolve) => {
      held.release = resolve;
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
    held.action = null;
    held.release = null;
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
      held.action = "apiKey.create";

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

      held.release?.();
      const result = await observed;
      expect(result?.token).toBe("sk-lw-test-token");
      expect(result?.apiKey.id).toBe(API_KEY_ID);
    });
  });

  describe("update", () => {
    it("does not answer while the audit write is still open", async () => {
      held.action = "apiKey.update";

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

      held.release?.();
      expect(await observed).toMatchObject({ id: API_KEY_ID });
    });
  });

  describe("revoke", () => {
    it("does not answer while the audit write is still open", async () => {
      held.action = "apiKey.revoke";

      const { state, observed } = watch(
        caller.revoke({ organizationId: ORG_ID, apiKeyId: API_KEY_ID }),
      );

      await drainMicrotasks();
      expect(service.revoke).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      held.release?.();
      expect(await observed).toEqual({ success: true });
    });
  });
});
