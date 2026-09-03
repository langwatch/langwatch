/**
 * @vitest-environment node
 *
 * The `integrationsChecks.*` surface: the one procedure the onboarding
 * screens call, the gate it declares, the project it forwards, and the
 * rollup it hands back untouched.
 *
 * The evidence behind that rollup belongs to nine other verticals, so this
 * transport owns none of it. What it does own is worth pinning: that the
 * policy is applied to an ALREADY-PARSED procedure — a check installed ahead
 * of the parser reads no project id and every guard still reports green — and
 * that the port's answer reaches the caller as its own shape rather than a
 * copy the transport rebuilt.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { IntegrationsChecksTrpcApi } from "../integrations-checks.api";

type TestContext = {
  session: { user: { id: string } } | null;
};

type CheckStatus = { workflows: number; integrated: boolean };

function harness({
  getCheckStatus = async () => ({ workflows: 0, integrated: false }),
}: {
  getCheckStatus?: (ctx: object, input: Readonly<{ projectId: string }>) => Promise<CheckStatus>;
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const declared: AuthzPermission[] = [];
  const parsedInputs: unknown[] = [];
  const port =
    vi.fn<(ctx: object, input: Readonly<{ projectId: string }>) => Promise<CheckStatus>>(
      getCheckStatus,
    );

  const router = IntegrationsChecksTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: (permission) => {
        declared.push(permission);
        return (procedure) =>
          (procedure as { use(m: unknown): typeof procedure }).use(
            ({ input, next }: { input: unknown; next: () => Promise<unknown> }) => {
              parsedInputs.push(input);
              return next();
            },
          );
      },
    },
    { getCheckStatus: port },
  );

  return {
    declared,
    parsedInputs,
    port,
    caller: router.createCaller({ session: { user: { id: "reader" } } }),
    anonymousCaller: router.createCaller({ session: null }),
  };
}

describe("IntegrationsChecksTrpcApi", () => {
  describe("given a signed-in reader", () => {
    it("forwards the validated project id and answers with the port's own rollup", async () => {
      const rollup = { workflows: 1, integrated: true };
      const { caller, port } = harness({ getCheckStatus: async () => rollup });

      await expect(caller.getCheckStatus({ projectId: "project-1" })).resolves.toBe(rollup);
      expect(port).toHaveBeenCalledTimes(1);
      expect(port.mock.calls[0]?.[1]).toEqual({ projectId: "project-1" });
    });

    it("declares project:update, the gate a reader who can act on a step holds", () => {
      expect(harness().declared).toEqual(["project:update"]);
    });
  });

  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware where `.input()` is
     * called, so anything installed before it runs with `input === undefined`.
     * The process's real policy resolves the authorized project id FROM the
     * input, which is why this feature applies the decorator after its own
     * parser.
     */
    it("hands the policy the parsed input, not undefined", async () => {
      const { caller, parsedInputs } = harness();

      await caller.getCheckStatus({ projectId: "project-1" });

      expect(parsedInputs).toEqual([{ projectId: "project-1" }]);
    });
  });

  describe("when the caller names no project", () => {
    it("refuses on the parser and never reaches the rollup", async () => {
      const { caller, port } = harness();

      await expect(
        (caller as unknown as { getCheckStatus(input: unknown): Promise<unknown> }).getCheckStatus(
          {},
        ),
      ).rejects.toBeInstanceOf(TRPCError);
      expect(port).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has no session", () => {
    it("refuses on the process's authenticated procedure", async () => {
      const { anonymousCaller, port } = harness();

      await expect(
        anonymousCaller.getCheckStatus({ projectId: "project-1" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(port).not.toHaveBeenCalled();
    });
  });
});
