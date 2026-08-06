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

/** A handled error as the tRPC boundary puts it on the wire. */
const handledTrpcError = ({
  code,
  httpStatus,
}: {
  code: string;
  httpStatus: number;
}) =>
  new TRPCClientError(code, {
    result: {
      error: {
        data: {
          code: "CONFLICT",
          httpStatus,
          error: { code, httpStatus, fault: "platform", meta: {} },
        },
      },
    },
  } as never);

describe("shouldRetryQuery", () => {
  describe("given a query that failed", () => {
    describe("when the failure names a cause a retry cannot fix", () => {
      /** @scenario "A preview failure only an operator can fix is not retried" */
      it("does not retry an unlinked subscription", () => {
        const error = handledTrpcError({
          code: "subscription_not_linked",
          httpStatus: 409,
        });

        expect(shouldRetryQuery(0, error)).toBe(false);
      });

      it.each([
        "billing_currency_unsupported",
        "billing_customer_deleted",
        "subscription_service_unavailable",
      ])("does not retry %s", (code) => {
        expect(
          shouldRetryQuery(0, handledTrpcError({ code, httpStatus: 409 })),
        ).toBe(false);
      });
    });

    describe("when the failure is a conflict that says it resolves itself", () => {
      /** @scenario "A preview failure that resolves itself is retried" */
      it("keeps retrying, because its copy promises the customer it catches up", () => {
        // Same status as `subscription_not_linked`, opposite remediation — which
        // is why the rule keys on the code rather than on 409.
        const error = handledTrpcError({
          code: "subscription_sync_failed",
          httpStatus: 409,
        });

        expect(shouldRetryQuery(0, error)).toBe(true);
      });
    });

    describe("when the failure is a bare conflict with no handled payload", () => {
      it("retries — a conflict is frequently a race that settles", () => {
        expect(shouldRetryQuery(0, trpcErrorWithStatus(409))).toBe(true);
      });
    });

    describe("when the failure is a client error", () => {
      it.each([
        400, 401, 403, 404, 422, 431,
      ])("does not retry a %i", (status) => {
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

      it("stops at the budget even for a permanent code", () => {
        const error = handledTrpcError({
          code: "subscription_not_linked",
          httpStatus: 409,
        });

        expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
      });
    });

    describe("when the failure is not a tRPC error", () => {
      it("retries network-level failures", () => {
        expect(shouldRetryQuery(0, new Error("fetch failed"))).toBe(true);
      });
    });
  });
});
