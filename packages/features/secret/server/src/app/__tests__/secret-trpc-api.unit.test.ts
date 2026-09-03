/**
 * The tRPC surface itself: the four procedure names the clients call, and the
 * permission each one declares.
 *
 * The permission is the whole point of this test. `secrets.*` moved from a
 * router that declared `.permission("secrets:view" | "secrets:manage")` per
 * procedure into this package, and the only thing that keeps those exact
 * grants attached is the argument passed to `policy`. A rename or a
 * copy-paste that gives `list` the manage permission — or `delete` the view
 * one — is caught here rather than in production.
 *
 * The host injects the policy, so this also pins the fallback: a host that
 * injects none still authorizes, through `ctx.authorize`.
 */
import type { SecretService } from "@langwatch/secret-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { SecretApp } from "../secret.app";

import { SecretTrpcApi, type SecretTrpcPolicy } from "../../transport/api-trpc/secret.api";

/** The `.use()` surface the injected policy applies its middleware through. */
type ChainableProcedure = { use(middleware: unknown): ChainableProcedure };

type TestContext = {
  app: { secrets: SecretApp };
  actor(): { id: string };
  authorize(permission: string, target: { projectId: string }): Promise<void>;
  session: { user: { id: string } } | null;
};

/**
 * A placeholder for the field a real caller fills with a credential. Nothing
 * in this suite prints it, and no assertion reads it back.
 */
const PLACEHOLDER_VALUE = "placeholder";

function secretsStub(overrides: Partial<SecretService> = {}): SecretService {
  return {
    list: vi.fn(async () => []),
    create: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SecretService;
}

function harness({ withPolicy = true } = {}) {
  /** Every permission the applied policy was built for, in mount order. */
  const declared: string[] = [];
  const authorize = vi.fn(async () => {});
  const secrets = secretsStub();
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the host's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  /**
   * Records the permission and then applies a middleware, so the assertions
   * can read both what was declared and that the policy really wraps the
   * procedure rather than being dropped.
   */
  const applied: string[] = [];
  const policy: SecretTrpcPolicy =
    (permission) =>
    <TProcedure>(procedure: TProcedure): TProcedure => {
      declared.push(permission);
      return (procedure as ChainableProcedure).use(({ next }: { next: () => unknown }) => {
        applied.push(permission);
        return next();
      }) as TProcedure;
    };

  const router = SecretTrpcApi.create(
    trpc,
    withPolicy ? { protected: authenticated, policy } : { protected: authenticated },
  );

  return {
    declared,
    applied,
    authorize,
    secrets,
    caller: router.createCaller({
      app: { secrets: SecretApp.create({ secrets }) },
      actor: () => ({ id: "user-1" }),
      authorize,
      session: { user: { id: "user-1" } },
    }),
  };
}

describe("SecretTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = SecretTrpcApi.create(trpc, {
        protected: trpc.procedure,
        policy: () => (procedure) => procedure,
      });

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "create",
        "delete",
        "list",
        "update",
      ]);
    });

    it("declares the read permission on the read and the manage permission on every write", () => {
      const { declared } = harness();

      expect(declared).toEqual([
        "secrets:view",
        "secrets:manage",
        "secrets:manage",
        "secrets:manage",
      ]);
    });
  });

  describe("when a host injects its own policy", () => {
    it("runs it on the read", async () => {
      const { caller, applied } = harness();

      await caller.list({ projectId: "project-1" });

      expect(applied).toEqual(["secrets:view"]);
    });

    it("runs it on each write", async () => {
      const create = harness();
      await create.caller.create({
        projectId: "project-1",
        name: "MY_SECRET",
        value: PLACEHOLDER_VALUE,
      });
      expect(create.applied).toEqual(["secrets:manage"]);

      const update = harness();
      await update.caller.update({
        projectId: "project-1",
        secretId: "secret-1",
        value: PLACEHOLDER_VALUE,
      });
      expect(update.applied).toEqual(["secrets:manage"]);

      const remove = harness();
      await remove.caller.delete({ projectId: "project-1", secretId: "secret-1" });
      expect(remove.applied).toEqual(["secrets:manage"]);
    });

    it("does not also authorize through the context", async () => {
      const { caller, authorize } = harness();

      await caller.list({ projectId: "project-1" });

      expect(authorize).not.toHaveBeenCalled();
    });
  });

  describe("when a host injects no policy", () => {
    it("authorizes each procedure at the input's project through the context", async () => {
      const { caller, authorize } = harness({ withPolicy: false });

      await caller.list({ projectId: "project-1" });
      await caller.create({
        projectId: "project-2",
        name: "MY_SECRET",
        value: PLACEHOLDER_VALUE,
      });
      await caller.update({
        projectId: "project-3",
        secretId: "secret-1",
        value: PLACEHOLDER_VALUE,
      });
      await caller.delete({ projectId: "project-4", secretId: "secret-1" });

      expect(authorize.mock.calls).toEqual([
        ["secrets:view", { projectId: "project-1" }],
        ["secrets:manage", { projectId: "project-2" }],
        ["secrets:manage", { projectId: "project-3" }],
        ["secrets:manage", { projectId: "project-4" }],
      ]);
    });

    it("refuses the call when that authorization refuses", async () => {
      const { caller, authorize, secrets } = harness({ withPolicy: false });
      authorize.mockRejectedValueOnce(new TRPCError({ code: "FORBIDDEN" }));

      await expect(caller.list({ projectId: "project-1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(secrets.list).not.toHaveBeenCalled();
    });
  });
});
