import { describe, expect, it } from "vitest";

import { MAX_QUERY_RETRIES, queryRetryDelay, shouldRetryQuery } from "../query/query-retry.ts";

/** A bare tRPC failure, carrying only the status. */
const withStatus = (httpStatus: number) => ({ data: { httpStatus } });

/** A handled error as the tRPC boundary puts it on the wire. */
const handled = ({ code, httpStatus }: { code: string; httpStatus: number }) => ({
  data: { httpStatus, error: { code, httpStatus, fault: "platform", meta: {} } },
});

describe("shouldRetryQuery", () => {
  describe("given a query that failed", () => {
    describe("when the api answers that it is upgrading", () => {
      /** @scenario "The browser retries a read answered upgrade_in_progress" */
      it("keeps retrying past the usual retry limit", () => {
        const upgrading = handled({ code: "upgrade_in_progress", httpStatus: 503 });

        expect(shouldRetryQuery(MAX_QUERY_RETRIES + 10, upgrading)).toBe(true);
      });
    });

    describe("when the personal workspace is still being created", () => {
      it("keeps retrying past the usual limit and polls every two seconds", () => {
        const pending = handled({ code: "personal_workspace_pending", httpStatus: 409 });

        expect(shouldRetryQuery(MAX_QUERY_RETRIES + 10, pending)).toBe(true);
        expect(queryRetryDelay(9, pending)).toBe(2_000);
      });
    });

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

describe("queryRetryDelay", () => {
  const throttled = (meta: Record<string, unknown> = {}) => ({
    data: {
      httpStatus: 429,
      error: { code: "rate_limited", httpStatus: 429, fault: "customer", meta },
    },
  });

  it("still retries a 429", () => {
    expect(shouldRetryQuery(0, throttled())).toBe(true);
  });

  it("follows Retry-After from the error when present, capped at 60 s", () => {
    expect(queryRetryDelay(0, throttled({ retryAfterMs: 7_000 }))).toBe(7_000);
    expect(queryRetryDelay(0, throttled({ retryAfterSeconds: 12 }))).toBe(12_000);
    expect(queryRetryDelay(0, throttled({ retryAfterSeconds: 600 }))).toBe(60_000);
  });

  it("backs off 5 s, 10 s, 20 s, 40 s without a hint", () => {
    expect([0, 1, 2, 3].map((n) => queryRetryDelay(n, throttled()))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it("keeps the default delays for other failures", () => {
    expect(queryRetryDelay(0, withStatus(500))).toBe(1_000);
    expect(queryRetryDelay(3, new Error("fetch failed"))).toBe(8_000);
    expect(queryRetryDelay(9, withStatus(500))).toBe(30_000);
  });
});
