/**
 * @vitest-environment node
 *
 * Server-side cover for the two typed rejections on the Langy turn-start path.
 *
 * WHY THIS FILE EXISTS: the whole premise of throwing a `HandledError` instead
 * of a bare `TRPCError` is that only a handled error puts `data.error` on the
 * wire — a raw `TRPCError` arrives with `data.error === null`, and the client's
 * explainer then cannot tell a throttled user from an internal crash, so it
 * renders the generic "something went wrong". Only the CLIENT half of that was
 * tested: revert either throw site to a bare `TRPCError` and every other test in
 * the repo stayed green while the users these changes exist for got the wrong
 * card. These tests run the REAL procedures through `createCaller` and then
 * through the REAL `errorFormatter`, so the assertion is about what actually
 * reaches the browser.
 */
import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { checkLangyMessageRateLimit, startConversationTurn, auditLog } =
  vi.hoisted(() => ({
    checkLangyMessageRateLimit: vi.fn(),
    startConversationTurn: vi.fn(),
    auditLog: vi.fn(),
  }));

vi.mock("~/server/middleware/rate-limit-langy", () => ({
  checkLangyMessageRateLimit,
  LANGY_MESSAGES_PER_MINUTE: 30,
}));

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({ langy: { turns: { startConversationTurn } } }),
}));

vi.mock("@ee/audit-log/auditLog", () => ({ auditLog }));

vi.mock("~/server/posthog", () => ({ trackServerEvent: vi.fn() }));

// The rollout gate and the demo refusal have their own tests
// (langyAccessMiddleware.unit.test.ts); here they must simply not stand in the
// way of the rejection under test.
vi.mock("../langyAccessMiddleware", () => ({
  enforceLangyAccess: ({ next }: any) => next(),
  refuseDemoProject: ({ next }: any) => next(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

import { LangyRateLimitedError } from "~/server/app-layer/langy/errors";
import { createInnerTRPCContext, errorFormatter } from "../../trpc";
import { langyRouter } from "../langy";

const caller = () =>
  langyRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "user_1", email: "user@example.com" },
        expires: "1",
      } as any,
      req: undefined,
      res: undefined,
      permissionChecked: false,
      publiclyShared: false,
    }),
  );

const message = {
  role: "user" as const,
  parts: [{ type: "text", text: "hi" }],
};

/**
 * Put a caught error through the SAME formatter production uses, so what these
 * tests assert is the wire shape, not an in-process object. `shape` is the
 * envelope tRPC hands the formatter; only the fields the formatter reads matter.
 */
function onTheWire(error: unknown) {
  const trpcError = error as TRPCError;
  return errorFormatter({
    shape: {
      message: trpcError.message,
      code: -32600,
      data: { code: trpcError.code, httpStatus: 400, path: "langy.x" },
    },
    error: trpcError,
  });
}

describe("langy turn-start rejections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkLangyMessageRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 29,
    });
    auditLog.mockResolvedValue(undefined);
    startConversationTurn.mockResolvedValue({
      conversationId: "c1",
      turnId: "t1",
    });
  });

  describe("when the per-user message rate limit refuses the send", () => {
    it("rejects with a handled LangyRateLimitedError (429) before the app layer", async () => {
      checkLangyMessageRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
      });

      const error = await caller()
        .createConversation({
          projectId: "project_1",
          idempotencyKey: "idem-key-0001",
          messages: [message],
        })
        .then(
          () => {
            throw new Error("expected the turn to be refused");
          },
          (e: unknown) => e,
        );

      expect(error).toBeInstanceOf(TRPCError);
      expect(error).toMatchObject({ code: "TOO_MANY_REQUESTS" });
      expect((error as TRPCError).cause).toBeInstanceOf(LangyRateLimitedError);
      expect((error as TRPCError).cause).toMatchObject({
        code: "langy_rate_limited",
        httpStatus: 429,
      });
      // Precedence: a throttled caller never reaches the app layer, so no key
      // is minted and no worker is dispatched.
      expect(startConversationTurn).not.toHaveBeenCalled();
    });

    it("carries a non-null data.error the client explainer can key on", async () => {
      checkLangyMessageRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
      });

      const error = await caller()
        .createConversation({
          projectId: "project_1",
          idempotencyKey: "idem-key-0001",
          messages: [message],
        })
        .catch((e: unknown) => e);

      // THE POINT: a bare TRPCError serialises with `data.error === null`, and
      // the panel then shows the generic crash card to a merely-throttled user.
      const wire = onTheWire(error);
      expect(wire.data.error).not.toBeNull();
      expect(wire.data.error).toMatchObject({ code: "langy_rate_limited" });
    });
  });

  describe("when the send carries a modelOverride", () => {
    /** @scenario A model id that itself contains a slash is accepted */
    it("accepts a custom-provider model whose id contains a slash and forwards it intact", async () => {
      const result = await caller().createConversation({
        projectId: "project_1",
        idempotencyKey: "idem-key-0001",
        messages: [message],
        modelOverride: "custom/stealth/ox-alpha",
      });

      expect(result).toMatchObject({ conversationId: "c1", turnId: "t1" });
      expect(startConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({ modelOverride: "custom/stealth/ox-alpha" }),
      );
    });

    /** @scenario A model from a named provider row is accepted with the row id in front */
    it("accepts the canonical mp_<rowId> wire form with a multi-segment model", async () => {
      const result = await caller().createConversation({
        projectId: "project_1",
        idempotencyKey: "idem-key-0001",
        messages: [message],
        modelOverride: "mp_01jm7qk3v8/deepseek/deepseek-r1:free",
      });

      expect(result).toMatchObject({ conversationId: "c1", turnId: "t1" });
      expect(startConversationTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          modelOverride: "mp_01jm7qk3v8/deepseek/deepseek-r1:free",
        }),
      );
    });

    /** @scenario A model reference without a provider segment is rejected as invalid input */
    it("rejects a model without a provider segment as a validation_error naming the field", async () => {
      const error = await caller()
        .createConversation({
          projectId: "project_1",
          idempotencyKey: "idem-key-0001",
          messages: [message],
          modelOverride: "gpt-5-mini",
        })
        .catch((e: unknown) => e);

      // Input-parse failures reject as BAD_REQUEST with the ZodError as the
      // cause; the errorFormatter is what promotes them to the handled
      // `validation_error` on the wire.
      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      // The wire names the offending field, so the client card can say which
      // value to look at instead of the anonymous fallback sentence.
      const wire = onTheWire(error);
      expect(wire.data.error).not.toBeNull();
      expect(wire.data.error).toMatchObject({ code: "validation_error" });
      expect(
        (wire.data.error as { meta: { fieldErrors: Record<string, unknown> } })
          .meta.fieldErrors,
      ).toHaveProperty("modelOverride");
      expect(startConversationTurn).not.toHaveBeenCalled();
    });

    /** @scenario A model reference with an empty segment is rejected as invalid input */
    it("rejects a reference whose model segment is empty", async () => {
      const error = await caller()
        .createConversation({
          projectId: "project_1",
          idempotencyKey: "idem-key-0001",
          messages: [message],
          // THE POINT: the slash is a delimiter, not a model. Widening the
          // pattern for aggregator ids must not let a bare delimiter through —
          // there is no model here for the allowlist check to match.
          modelOverride: "custom//stealth",
        })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "BAD_REQUEST" });

      const wire = onTheWire(error);
      expect(wire.data.error).not.toBeNull();
      expect(wire.data.error).toMatchObject({ code: "validation_error" });
      expect(
        (wire.data.error as { meta: { fieldErrors: Record<string, unknown> } })
          .meta.fieldErrors,
      ).toHaveProperty("modelOverride");
      expect(startConversationTurn).not.toHaveBeenCalled();
    });
  });

  describe("when the send carries neither idempotencyKey nor requestId", () => {
    it("rejects with a ValidationError whose meta.message survives serialization", async () => {
      const error = await caller()
        .createConversation({
          projectId: "project_1",
          messages: [message],
        })
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
      expect((error as TRPCError).cause).toMatchObject({
        code: "validation_error",
        httpStatus: 422,
      });

      // `meta.message` is the one channel that survives serialize() (ADR-045) —
      // a HandledError's own `message` is deliberately not put on the wire, so
      // without meta the client has a code and no sentence to render.
      const wire = onTheWire(error);
      expect(wire.data.error).not.toBeNull();
      expect(wire.data.error).toMatchObject({
        code: "validation_error",
        meta: { message: "idempotencyKey is required." },
      });
      expect(startConversationTurn).not.toHaveBeenCalled();
    });
  });
});
