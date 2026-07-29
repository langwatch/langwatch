import { HandledError } from "@langwatch/handled-error";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { handleTrpcCallLogging } from "../trpc";

function createMockLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const baseArgs = {
  path: "suites.getAll",
  type: "query",
  duration: 42,
  userAgent: "test-agent",
  statusCode: 200,
};

describe("handleTrpcCallLogging", () => {
  describe("given a successful result", () => {
    describe("when result.ok is true", () => {
      it("logs at info level", () => {
        const log = createMockLog();
        const capture = vi.fn();

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: true },
          log,
          capture,
        });

        expect(log.info).toHaveBeenCalledWith(
          expect.objectContaining({ path: "suites.getAll", duration: 42 }),
          "trpc call",
        );
        expect(log.warn).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a failed result", () => {
    describe("when error is INTERNAL_SERVER_ERROR", () => {
      it("derives 500 from TRPCError code, logs at error level, and captures", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "boom",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "suites.getAll",
            error,
            statusCode: 500,
          }),
          "trpc call",
        );
        expect(capture).toHaveBeenCalledWith(error);
        expect(log.info).not.toHaveBeenCalled();
      });
    });

    describe("when error is BAD_REQUEST", () => {
      it("derives 400 from TRPCError code and logs at warn level", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "BAD_REQUEST",
          message: "bad request",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ error, statusCode: 400 }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
      });
    });

    describe("when error is NOT_FOUND", () => {
      it("derives 404 from TRPCError code and logs at info level", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new TRPCError({
          code: "NOT_FOUND",
          message: "not found",
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.info).toHaveBeenCalledWith(
          expect.objectContaining({ error, statusCode: 404 }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
        expect(log.warn).not.toHaveBeenCalled();
      });
    });

    describe("when error is a plain Error (not TRPCError)", () => {
      it("defaults to 500 behavior", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new Error("unexpected");

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({ statusCode: 500 }),
          "trpc call",
        );
        expect(capture).toHaveBeenCalledWith(error);
      });
    });

    describe("when the cause is a HandledError", () => {
      class CustomerBoom extends HandledError {
        constructor() {
          super("customer_boom", "fixable by the caller", {
            httpStatus: 500,
            fault: "customer",
          });
        }
      }

      class PlatformBoom extends HandledError {
        constructor() {
          super("platform_boom", "our infra is down", {
            httpStatus: 503,
            fault: "platform",
          });
        }
      }

      class ProviderBoom extends HandledError {
        constructor() {
          super("provider_unreachable", "the provider never answered", {
            httpStatus: 502,
            fault: "provider",
          });
        }
      }

      /** @scenario "Log level follows fault attribution, not handled-ness" */
      it("logs customer-fault errors at warn, even for 5xx, and does not capture", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new CustomerBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 500,
            handledErrorCode: "customer_boom",
            handledErrorFault: "customer",
          }),
          "trpc call",
        );
        expect(log.error).not.toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
      });

      /** @scenario "Log level follows fault attribution, not handled-ness" */
      it("logs platform-fault errors at error but still does not capture", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new PlatformBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            // 503, not the 500 the envelope carries: tRPC v10 has no code for
            // it, so the code-derived status understates what happened.
            statusCode: 503,
            handledErrorCode: "platform_boom",
            handledErrorFault: "platform",
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
      });

      /**
       * An upstream that never answered is not our error budget. tRPC v10
       * cannot express 502, so without preferring the handled status every
       * customer typo in a base URL is recorded as a LangWatch 500.
       */
      it("records a provider fault at its own status, not the envelope's 500", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const cause = new ProviderBoom();
        const error = new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: cause.message,
          cause,
        });

        handleTrpcCallLogging({
          ...baseArgs,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalledWith(
          expect.objectContaining({
            statusCode: 502,
            handledErrorCode: "provider_unreachable",
            handledErrorFault: "provider",
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });
});
