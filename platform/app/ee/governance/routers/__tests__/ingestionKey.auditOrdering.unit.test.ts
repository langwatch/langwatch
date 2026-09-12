// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Pins the ordering half of #8097 on the tRPC ingestion-key surface.
 *
 * `install` and `rotate` dispatched their audit write with `void
 * auditLog(...)`, so the row was still in flight when the mutation handed
 * back a token the response shows exactly once. They now await it.
 *
 * The sibling integration case
 * (`ingestionKey.auditDurability.integration.test.ts`) pins the other half of
 * the bargain — a rejected audit write must not swallow the token — and
 * explains why a database-visibility assertion cannot see the ordering at
 * this boundary. This file watches the seam instead: hold the audit write
 * open and the mutation must not answer. Revert an `await` to `void` and it
 * answers immediately, which is the defect.
 *
 * No sleeps, no polling, no fake timers. The audit promise is released by
 * hand, and the single yield is a macrotask tick — every microtask the
 * handler could still be waiting on has drained by the time it fires.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { ingestionKeyRouter } from "../ingestionKey";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }),
}));

// The gate on both mutations is "organization:view", i.e. "are you a member
// of this org" — decided elsewhere and pinned by the router's integration
// cases. These two stubs let a declared check run without a real App behind
// it, and answer yes.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import(
    "~/test-utils/appPermissionsMock"
  );
  return appPermissionsMock();
});

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    hasOrganizationPermission: vi.fn(async () => true),
  };
});

/**
 * Only the router's own write is held open. The tRPC middleware audits every
 * mutation under its procedure path and runs *after* the handler, so holding
 * that one would block the caller however the router dispatches — the case
 * would pass against the unfixed code. `install` is separable by action
 * (`ingestionKey.mint` vs the middleware's path); `rotate` is not, so it is
 * held by the `apiKeyId` only the router records.
 */
const { held } = vi.hoisted(() => ({
  held: {
    match: null as null | ((entry: { action: string; args?: any }) => boolean),
    release: null as null | (() => void),
  },
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: (entry: { action: string; args?: any }) => {
    if (!held.match?.(entry)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      held.release = resolve;
    });
  },
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const API_KEY_ID = "ak_ingest_1";

const service = vi.hoisted(() => ({
  mint: vi.fn(),
  revokeForSource: vi.fn(),
}));

// The service is a collaborator, not the unit: these cases are about when
// the router answers relative to its audit write, so minting resolves
// immediately and the audit write is the only thing that can hold the
// mutation open.
vi.mock("@ee/governance/services/ingestionKey.service", () => ({
  IngestionKeyService: { create: () => service },
}));

function buildCaller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: USER_ID }, expires: "1" },
    req: undefined,
    res: undefined,
    // The permission gate is "are you a member of this org", proven by the
    // router's own integration cases; these ones start past it.
    permissionChecked: true,
    publiclyShared: false,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  return ingestionKeyRouter.createCaller(ctx);
}

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

const INPUT = { organizationId: ORG_ID, sourceType: "otel-python" };

describe("ingestionKey router — the audit row is durable before the caller is told", () => {
  let caller: ReturnType<typeof ingestionKeyRouter.createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    held.match = null;
    held.release = null;
    service.mint.mockResolvedValue({
      apiKeyId: API_KEY_ID,
      token: "ik-lw-test-token",
    });
    service.revokeForSource.mockResolvedValue({
      revokedCount: 2,
      sessions: [],
    });
    caller = buildCaller();
  });

  describe("install", () => {
    it("does not answer with the token while the audit write is still open", async () => {
      held.match = (entry) => entry.action === "ingestionKey.mint";

      const { state, observed } = watch(caller.install(INPUT));

      await drainMicrotasks();
      expect(service.mint).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      held.release?.();
      expect(await observed).toMatchObject({ token: "ik-lw-test-token" });
    });
  });

  describe("rotate", () => {
    it("does not answer with the replacement token while the audit write is still open", async () => {
      held.match = (entry) =>
        entry.action === "ingestionKey.rotate" &&
        typeof entry.args?.apiKeyId === "string";

      const { state, observed } = watch(caller.rotate(INPUT));

      await drainMicrotasks();
      expect(service.revokeForSource).toHaveBeenCalledTimes(1);
      expect(service.mint).toHaveBeenCalledTimes(1);
      expect(state.settled).toBe(false);

      held.release?.();
      expect(await observed).toMatchObject({ token: "ik-lw-test-token" });
    });
  });
});
