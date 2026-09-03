/**
 * The `createConversation` mutation's `modelOverride` shape gate (the
 * `provider/model` regex documented on `langyModelOverrideSchema`): a custom
 * aggregator id with extra slashes is forwarded intact, the canonical
 * `mp_<rowId>/...` wire form is accepted, and a reference missing its
 * provider segment or carrying an empty one is rejected before the app layer
 * ever sees it.
 *
 * Ported from platform/app/src/server/api/routers/__tests__/langy.turnErrors.unit.test.ts
 * (origin/main), adapted from the deleted app-router `langyRouter` +
 * `createInnerTRPCContext`/`errorFormatter` harness to `LangyTrpcApi.create`
 * mounted on a bare `initTRPC` root, mirroring
 * apps/api/src/features/evaluation/__tests__/evaluation-trpc.mount.unit.test.ts.
 * See specs/langy/langy-model-selection.feature.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LangyTrpcApi, type LangyTrpcContext } from "../langy.api";

const PROJECT_ID = "project_1";
const USER_ID = "user_1";

function harness() {
  const trpc = initTRPC.context<LangyTrpcContext>().create();
  const startTurn = vi.fn(async () => ({ conversationId: "c1", turnId: "t1" }));

  const router = LangyTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure.use(({ ctx, next }) => next({ ctx })),
      policy: () => (procedure) => procedure,
    },
    {
      checkMessageRateLimit: async () => ({ allowed: true }),
      checkWarmRateLimit: async () => ({ allowed: true }),
      recordProductEvent: () => {},
      uiActions: {
        claim: async () => ({ isClaimed: true }),
        complete: async () => ({ isAccepted: true }),
      },
    },
  );

  const caller = router.createCaller({
    app: { langy: { startTurn } as unknown as LangyTrpcContext["app"]["langy"] },
    actor: () => ({ id: USER_ID }),
    session: { user: { id: USER_ID } } as unknown as LangyTrpcContext["session"],
  });

  return { caller, startTurn };
}

const message = { role: "user" as const, parts: [{ type: "text", text: "hi" }] };

describe("langy createConversation modelOverride", () => {
  describe("when the send carries a modelOverride", () => {
    /** @scenario A model id that itself contains a slash is accepted */
    it("accepts a custom-provider model whose id contains a slash and forwards it intact", async () => {
      const { caller, startTurn } = harness();

      const result = await caller.createConversation({
        projectId: PROJECT_ID,
        idempotencyKey: "idem-key-0001",
        messages: [message],
        modelOverride: "custom/stealth/ox-alpha",
      });

      expect(result).toMatchObject({ conversationId: "c1", turnId: "t1" });
      expect(startTurn).toHaveBeenCalledWith(
        expect.objectContaining({ modelOverride: "custom/stealth/ox-alpha" }),
        expect.anything(),
        expect.anything(),
      );
    });

    /** @scenario A model from a named provider row is accepted with the row id in front */
    it("accepts the canonical mp_<rowId> wire form with a multi-segment model", async () => {
      const { caller, startTurn } = harness();

      const result = await caller.createConversation({
        projectId: PROJECT_ID,
        idempotencyKey: "idem-key-0001",
        messages: [message],
        modelOverride: "mp_01jm7qk3v8/deepseek/deepseek-r1:free",
      });

      expect(result).toMatchObject({ conversationId: "c1", turnId: "t1" });
      expect(startTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: "mp_01jm7qk3v8/deepseek/deepseek-r1:free",
        }),
        expect.anything(),
        expect.anything(),
      );
    });

    /** @scenario A model reference without a provider segment is rejected as invalid input */
    it("rejects a model without a provider segment as a validation error naming the field", async () => {
      const { caller, startTurn } = harness();

      const error = await caller
        .createConversation({
          projectId: PROJECT_ID,
          idempotencyKey: "idem-key-0001",
          messages: [message],
          modelOverride: "gpt-5-mini",
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      const cause = (error as TRPCError).cause as unknown as {
        issues?: Array<{ path: (string | number)[] }>;
        flatten?: () => { fieldErrors: Record<string, unknown> };
      };
      const fieldErrors = cause.flatten?.().fieldErrors;
      expect(fieldErrors).toHaveProperty("modelOverride");
      expect(startTurn).not.toHaveBeenCalled();
    });

    /** @scenario A model reference with an empty segment is rejected as invalid input */
    it("rejects a reference whose model segment is empty", async () => {
      const { caller, startTurn } = harness();

      const error = await caller
        .createConversation({
          projectId: PROJECT_ID,
          idempotencyKey: "idem-key-0001",
          messages: [message],
          // The slash is a delimiter, not a model: widening the pattern for
          // aggregator ids must not let a bare delimiter through.
          modelOverride: "custom//stealth",
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: "BAD_REQUEST" });
      const cause = (error as TRPCError).cause as unknown as {
        flatten?: () => { fieldErrors: Record<string, unknown> };
      };
      expect(cause.flatten?.().fieldErrors).toHaveProperty("modelOverride");
      expect(startTurn).not.toHaveBeenCalled();
    });
  });
});
