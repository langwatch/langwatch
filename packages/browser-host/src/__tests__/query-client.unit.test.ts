import { afterEach, describe, expect, it, vi } from "vitest";

import type { UiFailureNotice, UiSuccessNotice } from "../capabilities.ts";
import { createUiQueryClient } from "../query-client.ts";
import { shouldRetryQuery } from "../query-retry.ts";
import { setUiFeedbackHost } from "../toaster.ts";

function recordingHost() {
  const failed: UiFailureNotice[] = [];
  return {
    failed,
    host: {
      succeeded: (_notice: UiSuccessNotice) => {},
      failed: (failure: UiFailureNotice) => void failed.push(failure),
    },
  };
}

/** A handled error as tRPC carries it. */
const handled = ({ code, httpStatus }: { code: string; httpStatus: number }) => ({
  data: { httpStatus, error: { code, httpStatus, fault: "customer", meta: {} } },
});

/** Runs one mutation through the client's real cache until it settles, rejected. */
async function failMutation(client: ReturnType<typeof createUiQueryClient>, error: unknown) {
  const mutation = client.getMutationCache().build(client, {
    mutationFn: () => Promise.reject(error),
  });
  await mutation.execute(undefined).catch(() => {});
}

afterEach(() => {
  setUiFeedbackHost(void 0);
  vi.restoreAllMocks();
});

describe("createUiQueryClient", () => {
  describe("given a query", () => {
    it("retries through shouldRetryQuery — the one policy, not a client default", () => {
      const client = createUiQueryClient();

      expect(client.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
    });

    it("installs no QueryCache.onError — a query failure is never auto-reported", () => {
      const client = createUiQueryClient();

      expect(client.getQueryCache().config.onError).toBeUndefined();
    });
  });

  describe("when a mutation fails, with no override", () => {
    describe("when the failure carries a code the registry knows", () => {
      it("reports it through showErrorToast, whole, to the mounted feedback host", async () => {
        const { failed, host } = recordingHost();
        setUiFeedbackHost(host);
        const client = createUiQueryClient();
        const error = handled({ code: "validation_error", httpStatus: 400 });

        await failMutation(client, error);

        expect(failed[0]?.error).toBe(error);
      });
    });

    describe("when the failure is not a handled one", () => {
      it("still reports it, without inventing a code", async () => {
        const { failed, host } = recordingHost();
        setUiFeedbackHost(host);
        const client = createUiQueryClient();
        const error = new Error("boom");

        await failMutation(client, error);

        expect(failed[0]?.error).toBe(error);
        expect(failed[0]?.fallbackTitle).toBe("Something went wrong");
      });
    });

    describe("when no feedback host is mounted", () => {
      it("warns and drops the report rather than throwing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const client = createUiQueryClient();

        await failMutation(client, new Error("boom"));
        expect(warn).toHaveBeenCalled();
      });
    });
  });

  describe("when a mutation fails, with an override supplied", () => {
    it("calls the caller's reporter instead of showErrorToast", async () => {
      const { failed, host } = recordingHost();
      setUiFeedbackHost(host);
      const onMutationError = vi.fn();
      const client = createUiQueryClient({ onMutationError });
      const error = new Error("boom");

      await failMutation(client, error);

      // react-query hands a mutation reporter (error, variables, context, mutation);
      // only the first is this seam's contract.
      expect(onMutationError.mock.calls[0]?.[0]).toBe(error);
      expect(failed).toHaveLength(0);
    });
  });
});
