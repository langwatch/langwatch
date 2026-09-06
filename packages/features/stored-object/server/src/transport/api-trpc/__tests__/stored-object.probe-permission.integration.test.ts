/**
 * @vitest-environment node
 * @see specs/traces-v2/media-rendering.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { StoredObjectTrpcApi, type StoredObjectTrpcContext } from "../stored-object.api.ts";

const PROJECT_ID = "project-1";

type TestContext = StoredObjectTrpcContext & { grants: readonly AuthzPermission[] };

/** What the store answers for an id it holds no row for. */
const NOT_FOUND = { status: "not_found" } as const;

/**
 * The bytes are served behind `traces:view` OR `scenarios:view`. `policyAny`
 * refuses unless the viewer holds a permission the PROCEDURE declared, so a
 * pass is evidence of the declaration rather than of the harness.
 */
function harness() {
  const headById = vi.fn(async () => NOT_FOUND);
  const trpc = initTRPC.context<TestContext>().create();

  const policyAny =
    (...permissions: readonly AuthzPermission[]) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as { use: (middleware: unknown) => TProcedure }).use(
        (options: { ctx: TestContext; input: { projectId: string }; next: () => unknown }) => {
          if (options.input.projectId !== PROJECT_ID) {
            throw new Error(`unexpected project in this harness: ${options.input.projectId}`);
          }
          if (!permissions.some((permission) => options.ctx.grants.includes(permission))) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: permissions[0] ?? "no permission declared",
            });
          }
          return options.next();
        },
      );

  const router = StoredObjectTrpcApi.create(trpc, {
    protected: trpc.procedure,
    policyAny: policyAny as never,
    validateOutput: true,
  } as never);

  function callerHolding(...grants: AuthzPermission[]) {
    return router.createCaller({
      grants,
      app: { storedObjectApp: { headById } },
    } as never);
  }

  return { callerHolding, headById };
}

describe("storedObjects.headById: who may probe", () => {
  describe("given a viewer whose only grant is trace access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("answers the probe for a viewer holding traces:view", async () => {
      const { callerHolding, headById } = harness();

      const result = await callerHolding("traces:view").headById({
        projectId: PROJECT_ID,
        id: "absent-object",
      });

      expect(result).toEqual(NOT_FOUND);
      expect(headById).toHaveBeenCalledWith({ projectId: PROJECT_ID, id: "absent-object" });
    });
  });

  describe("given a viewer whose only grant is scenario access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("still answers the probe for a viewer holding scenarios:view", async () => {
      const { callerHolding } = harness();

      const result = await callerHolding("scenarios:view").headById({
        projectId: PROJECT_ID,
        id: "absent-object",
      });

      expect(result).toEqual(NOT_FOUND);
    });
  });

  describe("given a viewer holding neither trace nor scenario access", () => {
    /** @scenario "A viewer with trace access can probe trace media" */
    it("refuses the probe, naming the permission to ask for, and never reaches the store", async () => {
      const { callerHolding, headById } = harness();

      await expect(
        callerHolding("datasets:view").headById({
          projectId: PROJECT_ID,
          id: "absent-object",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "traces:view" });
      expect(headById).not.toHaveBeenCalled();
    });
  });
});
