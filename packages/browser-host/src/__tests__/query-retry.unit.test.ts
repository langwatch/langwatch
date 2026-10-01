import { describe, expect, it } from "vitest";

import { MAX_QUERY_RETRIES, shouldRetryQuery } from "../query-retry.ts";

/** A bare tRPC failure, carrying only the status. */
const withStatus = (httpStatus: number) => ({ data: { httpStatus } });

/** A handled error as the tRPC boundary puts it on the wire. */
const handled = ({ code, httpStatus }: { code: string; httpStatus: number }) => ({
  data: { httpStatus, error: { code, httpStatus, fault: "platform", meta: {} } },
});

describe("shouldRetryQuery", () => {
  describe("given a query that failed", () => {
    describe("when the failure names a cause a retry cannot fix", () => {
      /** @scenario "A preview failure only an operator can fix is not retried" */
      it("does not retry an unlinked subscription", () => {
        expect(
          shouldRetryQuery(0, handled({ code: "subscription_not_linked", httpStatus: 409 })),
        ).toBe(false);
      });

      it.each([
        "billing_currency_unsupported",
        "billing_customer_deleted",
        "subscription_service_unavailable",
      ])("does not retry %s", (code) => {
        expect(shouldRetryQuery(0, handled({ code, httpStatus: 409 }))).toBe(false);
      });
    });

    describe("when the failure is a conflict that says it resolves itself", () => {
      /** Same status as `subscription_not_linked`, opposite remediation — which
       *  is why the rule keys on the code rather than on 409.
       *  @scenario "A preview failure that resolves itself is retried" */
      it("keeps retrying, because its copy promises the customer it catches up", () => {
        expect(
          shouldRetryQuery(0, handled({ code: "subscription_sync_failed", httpStatus: 409 })),
        ).toBe(true);
      });
    });

    describe("when the failure is a bare conflict with no handled payload", () => {
      it("retries — a conflict is frequently a race that settles", () => {
        expect(shouldRetryQuery(0, withStatus(409))).toBe(true);
      });
    });

    describe("when the failure is a client error", () => {
      it.each([400, 401, 403, 404, 422, 431])("does not retry a %i", (status) => {
        expect(shouldRetryQuery(0, withStatus(status))).toBe(false);
      });
    });

    describe("when the failure is a server error", () => {
      it("retries a 500 until the retry budget runs out", () => {
        expect(shouldRetryQuery(0, withStatus(500))).toBe(true);
        expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, withStatus(500))).toBe(true);
        expect(shouldRetryQuery(MAX_QUERY_RETRIES, withStatus(500))).toBe(false);
      });

      it("stops at the budget even for a permanent code", () => {
        expect(
          shouldRetryQuery(
            MAX_QUERY_RETRIES,
            handled({ code: "subscription_not_linked", httpStatus: 409 }),
          ),
        ).toBe(false);
      });
    });

    describe("when the failure is not a tRPC error", () => {
      it("retries network-level failures", () => {
        expect(shouldRetryQuery(0, new Error("fetch failed"))).toBe(true);
      });
    });
  });
});
