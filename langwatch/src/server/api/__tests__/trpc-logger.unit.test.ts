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
            error: { code: "INTERNAL_SERVER_ERROR", message: "boom" },
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
          expect.objectContaining({
            error: { code: "BAD_REQUEST", message: "bad request" },
            statusCode: 400,
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
        expect(log.error).not.toHaveBeenCalled();
      });
    });

    describe("when error is NOT_FOUND", () => {
      it("derives 404 from TRPCError code and logs at warn level", () => {
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

        expect(log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            error: { code: "NOT_FOUND", message: "not found" },
            statusCode: 404,
          }),
          "trpc call",
        );
        expect(capture).not.toHaveBeenCalled();
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
          expect.objectContaining({
            error: { message: "unexpected" },
            statusCode: 500,
          }),
          "trpc call",
        );
        expect(capture).toHaveBeenCalledWith(error);
      });
    });
  });
});
