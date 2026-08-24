/** @vitest-environment node */

import { HandledError, NotFoundError } from "@langwatch/handled-error";
import { context as otelContext, trace } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { StackContextManager } from "@opentelemetry/sdk-trace-web";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorFormatter } from "../trpc";

function format(error: TRPCError) {
  return errorFormatter({
    shape: {
      message: error.message,
      code: -32603,
      data: {
        code: error.code,
        httpStatus: 500,
        stack: "PrismaClientKnownRequestError at db.internal",
      },
    },
    error,
  });
}

/**
 * Run `fn` inside a live span and hand back the trace id it ran under.
 *
 * `data.traceId` is read from the ambient span, so with no context manager
 * registered every trace-id assertion would pass or fail for the wrong reason —
 * there would simply never be a span. The app registers the same pair.
 */
function withActiveSpan<T>(fn: () => T): { result: T; traceId: string } {
  otelContext.setGlobalContextManager(new StackContextManager().enable());
  const provider = new BasicTracerProvider();
  const span = provider.getTracer("test").startSpan("trpc.call");
  try {
    return otelContext.with(trace.setSpan(otelContext.active(), span), () => ({
      result: fn(),
      traceId: span.spanContext().traceId,
    }));
  } finally {
    span.end();
    otelContext.disable();
  }
}

describe("tRPC error response boundary", () => {
  describe("given an unexpected infrastructure error", () => {
    describe("when it is formatted for the wire", () => {
      /** @scenario "A database crash is reported to the client as unknown" */
      it("masks it without removing it from the TRPCError", () => {
        const cause = new Error(
          "The findUnique action on LangyConversationProjection requires projectId",
        );
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        const formatted = format(error);

        expect(formatted.message).toBe("An unknown error occurred");
        expect(JSON.stringify(formatted)).not.toContain("findUnique");
        expect(JSON.stringify(formatted)).not.toContain("db.internal");
        expect(error.cause).toBe(cause);
      });

      /**
       * The unhandled path deliberately tells the client nothing about what
       * broke, which leaves support with nothing to correlate on — so the one
       * thing it must still carry is the id that ties "it broke" to the logs.
       * Nothing asserted this, on the path where it is the ONLY affordance.
       */
      /** @scenario "A database crash is reported to the client as unknown" */
      it("still carries the trace id, its only remaining affordance", () => {
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "connect ECONNREFUSED 10.0.0.5:5432",
          cause: new Error("connect ECONNREFUSED 10.0.0.5:5432"),
        });

        const { result, traceId } = withActiveSpan(() => format(error));

        expect(result.data.traceId).toBe(traceId);
      });
    });
  });

  describe("given a handled error", () => {
    describe("when it is formatted for the wire", () => {
      /** @scenario "A known failure is serialised as a handled error over tRPC" */
      /** @scenario "A handled error's free-text message does not cross the tRPC boundary" */
      it("replaces its free-text message with its stable code, keeping the structured envelope", () => {
        const cause = new NotFoundError(
          "langy_conversation_not_found",
          "Conversation",
          "conversation-1",
        );
        const error = new TRPCError({
          code: "NOT_FOUND",
          message: cause.message,
          cause,
        });

        const formatted = format(error);

        expect(formatted.message).toBe("langy_conversation_not_found");
        expect(JSON.stringify(formatted)).not.toContain(
          "Conversation not found: conversation-1",
        );
        expect(formatted.data.error).toMatchObject({
          code: "langy_conversation_not_found",
          httpStatus: 404,
        });
      });

      /** @scenario "A handled error's free-text message does not cross the tRPC boundary" */
      it("never leaks server configuration named in its message", () => {
        // Mirrors the reported leak: langy.createConversation returned
        // "LW_GATEWAY_BASE_URL is not configured on the control plane." as the
        // wire message alongside the sanitised error payload.
        class CredentialResolutionError extends HandledError {
          constructor(message: string) {
            super("langy_credential_resolution", message, { httpStatus: 409 });
          }
        }
        const cause = new CredentialResolutionError(
          "LW_GATEWAY_BASE_URL is not configured on the control plane.",
        );
        const error = new TRPCError({
          code: "CONFLICT",
          message: cause.message,
          cause,
        });

        const formatted = format(error);

        expect(JSON.stringify(formatted)).not.toContain("LW_GATEWAY_BASE_URL");
        expect(JSON.stringify(formatted)).not.toContain("db.internal");
        expect(formatted.message).toBe("langy_credential_resolution");
        expect(formatted.data.error).toMatchObject({
          code: "langy_credential_resolution",
          httpStatus: 409,
          fault: "customer",
        });
      });

      /** @scenario "Telemetry is captured from the active span" */
      it("carries the trace id alongside the code", () => {
        const error = new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found: c-1",
          cause: new NotFoundError(
            "langy_conversation_not_found",
            "Conversation",
            "c-1",
          ),
        });

        const { result, traceId } = withActiveSpan(() => format(error));

        expect(result.data.traceId).toBe(traceId);
      });
    });

    /**
     * A 5xx handled error is OUR failure, not the caller's, and `fault` is the
     * axis that says so — it drives log level and alerting, and an unannotated
     * 5xx logs a real incident as routine customer noise. The wire must carry
     * it, and the message must still collapse to the code like every other
     * handled error.
     */
    describe("when it is a 5xx the platform is at fault for", () => {
      /** @scenario "A handled error's free-text message does not cross the tRPC boundary" */
      it("ships the code as the message and `platform` as the fault", () => {
        class ExportWorkerSilentError extends HandledError {
          constructor() {
            super("export_failed", "The export worker never answered", {
              httpStatus: 500,
              fault: "platform",
            });
          }
        }
        const cause = new ExportWorkerSilentError();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        const formatted = format(error);

        expect(formatted.message).toBe("export_failed");
        expect(JSON.stringify(formatted)).not.toContain("export worker");
        expect(formatted.data.error).toMatchObject({
          code: "export_failed",
          httpStatus: 500,
          fault: "platform",
        });
      });
    });
  });

  describe("given a request that failed input validation", () => {
    describe("when it is formatted for the wire", () => {
      /** @scenario "Validation failures travel the one handled-error channel" */
      it("carries the failure as a handled error with the issues in meta", () => {
        // There is no sidecar `zodError` field any more: a ZodError is promoted
        // to the shared ValidationError so it travels the one handled-error
        // channel, and its issues ride in meta like every other domain fact.
        const parsed = z.object({ name: z.string().min(1) }).safeParse({});
        if (parsed.success) throw new Error("Expected validation to fail");
        const cause = parsed.error;
        const error = new TRPCError({
          code: "BAD_REQUEST",
          message: cause.message,
          cause,
        });

        const formatted = format(error);

        expect(formatted.data).not.toHaveProperty("zodError");
        expect(formatted.data.error).toMatchObject({
          code: "validation_error",
          meta: { fieldErrors: { name: expect.any(Array) } },
        });
      });
    });

  });

  describe("given a user-actionable 4xx", () => {
    describe("when it is formatted for the wire", () => {
      it("does not rewrite the procedure's own sentence", () => {
        const error = new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a project first",
        });

        expect(format(error).message).toBe("Choose a project first");
      });

      it("strips the development stack from it too", () => {
        const error = new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a project first",
        });

        expect(format(error).data).not.toHaveProperty("stack");
      });
    });
  });
});

/**
 * `data.authored` is the server's verdict on whether `message` is prose
 * somebody wrote for a person. The client renders it when true and degrades to
 * "we've been notified" when false, so a wrong verdict either leaks a driver
 * string or throws away the one sentence that told the user what to fix.
 */
describe("authored-message verdict", () => {
  describe("given a procedure that wrote its own copy", () => {
    it("marks a message with no cause as authored", () => {
      const error = new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Changing column types is not yet supported for large datasets",
      });

      expect(format(error).data.authored).toBe(true);
    });

    /**
     * The majority shape in this codebase: the sentence is ours, `cause` is
     * passed so the log line keeps the driver's story. Rejecting it on the
     * presence of `cause` told an admin who mistyped a field to wait for
     * something that was never going to change.
     */
    it("marks a message passed alongside a cause as authored", () => {
      const error = new TRPCError({
        code: "BAD_REQUEST",
        message: "That rule name is already in use",
        cause: new Error("Unique constraint failed on the fields: (`name`)"),
      });

      expect(format(error).data.authored).toBe(true);
      expect(format(error).message).toBe("That rule name is already in use");
    });
  });

  describe("given a message inherited from the cause", () => {
    /** @scenario "Only the boundary decides what counts as authored copy" */
    it("does not present a driver string as our own copy", () => {
      const cause = new Error("fetch failed");
      const error = new TRPCError({ code: "BAD_REQUEST", cause });

      const formatted = format(error);
      expect(formatted.message).toBe("fetch failed");
      expect(formatted.data.authored).toBe(false);
    });

    /** @scenario "Only the boundary decides what counts as authored copy" */
    it("looks past a wrapper that re-donated the same string", () => {
      const driver = new Error("connect ECONNREFUSED 10.0.0.5:5432");
      const wrapper = new Error(driver.message, { cause: driver });
      const error = new TRPCError({
        code: "BAD_REQUEST",
        message: driver.message,
        cause: wrapper,
      });

      expect(format(error).data.authored).toBe(false);
    });

    /**
     * An equality test called this authored and republished the embedded driver
     * string — the leak the gate exists to close, one concatenation away from
     * every procedure that writes `Saving failed: ${err.message}`.
     */
    it("catches a driver string concatenated into our own sentence", () => {
      const driver = new Error("Invalid time value");
      const error = new TRPCError({
        code: "BAD_REQUEST",
        message: `Saving failed: ${driver.message}`,
        cause: driver,
      });

      expect(format(error).data.authored).toBe(false);
    });
  });

  describe("given a cause the walk cannot take at face value", () => {
    /**
     * A cause that crossed a worker or serialisation boundary arrives as a
     * plain object carrying a `message` string, not an `Error`. An
     * `instanceof Error` guard made that shape invisible to the comparison and
     * published its string as our own copy.
     */
    it("treats a non-Error cause carrying a message as a donor", () => {
      const formatted = errorFormatter({
        shape: {
          message: "fetch failed",
          code: -32603,
          data: { code: "BAD_REQUEST", httpStatus: 400 },
        },
        error: {
          code: "BAD_REQUEST",
          message: "fetch failed",
          cause: { message: "fetch failed" },
        },
      });

      expect(formatted.data.authored).toBe(false);
    });

    /**
     * The walk is bounded so a self-referential chain cannot spin here. Running
     * out of budget is not proof the message is ours, so the verdict stays "not
     * authored" — showing a driver string is the worse of the two mistakes.
     */
    it("refuses to claim a message when the chain outruns the depth budget", () => {
      const driver = new Error("connect ECONNREFUSED 10.0.0.5:5432");
      const deepest = new Error("repository layer", { cause: driver });
      const middle = new Error("service layer", { cause: deepest });
      const outer = new Error("router layer", { cause: middle });
      const error = new TRPCError({
        code: "BAD_REQUEST",
        message: driver.message,
        cause: outer,
      });

      expect(format(error).data.authored).toBe(false);
    });

    /**
     * With no cause at all, tRPC falls back to the CODE NAME as the message, so
     * "undefined cause" and "nobody wrote copy" are the same event. The
     * code-name check is what catches it rather than the chain walk — either
     * way the customer must never read `BAD_REQUEST`.
     */
    it("does not present the tRPC code name as copy when the cause is undefined", () => {
      const error = new TRPCError({ code: "BAD_REQUEST", cause: undefined });

      const formatted = format(error);
      expect(formatted.message).toBe("BAD_REQUEST");
      expect(formatted.data.authored).toBe(false);
    });
  });

  describe("given no message at all", () => {
    /** @scenario "Only the boundary decides what counts as authored copy" */
    it("does not present the tRPC code name as copy", () => {
      const error = new TRPCError({ code: "NOT_FOUND" });

      const formatted = format(error);
      expect(formatted.message).toBe("NOT_FOUND");
      expect(formatted.data.authored).toBe(false);
    });
  });

  describe("given a handled error", () => {
    it("leaves presentation to the code registry", () => {
      const error = new TRPCError({
        code: "NOT_FOUND",
        message: "Conversation not found: c-1",
        cause: new NotFoundError(
          "langy_conversation_not_found",
          "Conversation",
          "c-1",
        ),
      });

      expect(format(error).data.authored).toBe(false);
    });
  });
});
