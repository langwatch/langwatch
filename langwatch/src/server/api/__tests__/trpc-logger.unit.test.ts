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
    describe("when status is 500", () => {
      it("logs at error level and captures the exception", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new Error("boom");

        handleTrpcCallLogging({
          ...baseArgs,
          statusCode: 500,
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

    describe("when status is 400", () => {
      it("logs at warn level and does not capture", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new Error("bad request");

        handleTrpcCallLogging({
          ...baseArgs,
          statusCode: 400,
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

    describe("when statusCode is null", () => {
      it("defaults to 500 behavior (error + capture)", () => {
        const log = createMockLog();
        const capture = vi.fn();
        const error = new Error("no status");

        handleTrpcCallLogging({
          ...baseArgs,
          statusCode: null,
          result: { ok: false, error },
          log,
          capture,
        });

        expect(log.error).toHaveBeenCalled();
        expect(capture).toHaveBeenCalledWith(error);
      });
    });

    describe("when status is 404", () => {
      it("logs at warn level (client error range)", () => {
        const log = createMockLog();
        const capture = vi.fn();

        handleTrpcCallLogging({
          ...baseArgs,
          statusCode: 404,
          result: { ok: false, error: new Error("not found") },
          log,
          capture,
        });

        expect(log.warn).toHaveBeenCalled();
        expect(capture).not.toHaveBeenCalled();
      });
    });
  });
});
