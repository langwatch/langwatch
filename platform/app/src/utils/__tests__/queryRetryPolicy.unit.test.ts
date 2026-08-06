import { TRPCClientError } from "@trpc/client";
import { describe, expect, it } from "vitest";

import { MAX_QUERY_RETRIES, shouldRetryQuery } from "../queryRetryPolicy";

const trpcErrorWithStatus = (httpStatus: number) =>
  new TRPCClientError("failed", {
    result: {
      error: {
        data: { code: "ERROR", httpStatus },
      },
    },
  } as never);

describe("shouldRetryQuery", () => {
  describe("when the failure is a conflict (409)", () => {
    it("does not retry — replaying a conflict cannot change the answer", () => {
      expect(shouldRetryQuery(0, trpcErrorWithStatus(409))).toBe(false);
    });
  });

  describe("when the failure is a client error", () => {
    it.each([400, 401, 403, 404, 422, 431])("does not retry a %i", (status) => {
      expect(shouldRetryQuery(0, trpcErrorWithStatus(status))).toBe(false);
    });
  });

  describe("when the failure is a server error", () => {
    it("retries a 500 until the retry budget runs out", () => {
      expect(shouldRetryQuery(0, trpcErrorWithStatus(500))).toBe(true);
      expect(
        shouldRetryQuery(MAX_QUERY_RETRIES - 1, trpcErrorWithStatus(500)),
      ).toBe(true);
      expect(
        shouldRetryQuery(MAX_QUERY_RETRIES, trpcErrorWithStatus(500)),
      ).toBe(false);
    });
  });

  describe("when the failure is not a tRPC error", () => {
    it("retries network-level failures", () => {
      expect(shouldRetryQuery(0, new Error("fetch failed"))).toBe(true);
    });
  });
});
