/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testConnectionMock = vi.fn();

vi.mock("../../utils/api", () => ({
  api: {
    modelProvider: {
      testConnection: {
        useMutation: () => ({ mutateAsync: testConnectionMock }),
      },
    },
  },
}));

import { useModelProviderConnectionTest } from "../useModelProviderConnectionTest";

const PROVIDER_ROW = "mp_1";

const renderTest = () =>
  renderHook(() =>
    useModelProviderConnectionTest({
      projectId: "proj_1",
      organizationId: "org_acme",
    }),
  );

beforeEach(() => {
  testConnectionMock.mockReset();
});

describe("useModelProviderConnectionTest", () => {
  describe("when the provider accepts the stored credential", () => {
    /** @scenario "A working credential says so" */
    it("reports that the connection works", async () => {
      testConnectionMock.mockResolvedValue({ outcome: "verified" });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });

      await waitFor(() => {
        expect(result.current.results[PROVIDER_ROW]).toEqual({
          status: "works",
        });
      });
    });
  });

  describe("when the provider refuses the stored credential", () => {
    /** @scenario "A refused credential is explained in our own words" */
    it("explains the refusal without repeating what the provider said", async () => {
      // The provider's own sentence is the text that quotes the request back,
      // and a rejected-credential body is exactly where a credential turns up.
      // The words shown come from the code-keyed registry instead, so a
      // refusal reads the same however the upstream chose to phrase it.
      testConnectionMock.mockResolvedValue({
        outcome: "refused",
        domainError: {
          code: "provider_key_invalid",
          message: "provider_key_invalid",
          meta: {},
        },
      });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });

      await waitFor(() => {
        const state = result.current.results[PROVIDER_ROW];
        expect(state?.status).toBe("refused");
        const message = state && "message" in state ? state.message : "";
        expect(message).toContain("refused");
        // Never the raw code, which is what a handled error's message becomes
        // on the wire, and never the upstream's own explanation.
        expect(message).not.toContain("provider_key_invalid");
      });
    });
  });

  describe("when the provider cannot be checked at all", () => {
    it("says the check did not run rather than that it passed", async () => {
      testConnectionMock.mockResolvedValue({
        outcome: "unchecked",
        reason: "provider_not_probeable",
      });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });

      await waitFor(() => {
        const state = result.current.results[PROVIDER_ROW];
        expect(state?.status).toBe("unchecked");
        const message = state && "message" in state ? state.message : "";
        expect(message).not.toContain("works");
      });
    });

    it("points at the missing credential when that is the reason", async () => {
      testConnectionMock.mockResolvedValue({
        outcome: "unchecked",
        reason: "no_credential",
      });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });

      await waitFor(() => {
        const state = result.current.results[PROVIDER_ROW];
        const message = state && "message" in state ? state.message : "";
        expect(message).toContain("No credential");
      });
    });
  });

  describe("when the request itself fails", () => {
    it("reports a failure to ask, not a verdict on the credential", async () => {
      testConnectionMock.mockRejectedValue(new Error("boom"));

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });

      await waitFor(() => {
        const state = result.current.results[PROVIDER_ROW];
        expect(state?.status).toBe("unchecked");
        expect(state?.status).not.toBe("refused");
      });
    });
  });

  describe("when several rows are tested", () => {
    it("keeps each row's verdict to itself", async () => {
      testConnectionMock.mockResolvedValueOnce({ outcome: "verified" });
      testConnectionMock.mockResolvedValueOnce({
        outcome: "unchecked",
        reason: "provider_not_probeable",
      });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test("mp_a");
      });
      await act(async () => {
        await result.current.test("mp_b");
      });

      await waitFor(() => {
        expect(result.current.results.mp_a?.status).toBe("works");
        expect(result.current.results.mp_b?.status).toBe("unchecked");
      });
    });
  });
});
