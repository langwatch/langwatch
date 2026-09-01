/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderCredentialVerdict } from "@langwatch/model-provider-contract";

/**
 * Typed against the contract, not `vi.fn()` bare.
 *
 * This suite stayed green through the extraction that collapsed the
 * procedure's output to `{ connected: boolean }`, because an untyped mock
 * answered with the union the hook expected while the server no longer sent
 * it. The type parameter is what makes the mock unable to disagree with the
 * wire: a shape the contract stops producing stops compiling here.
 */
const testConnectionMock = vi.fn<() => Promise<ModelProviderCredentialVerdict>>();

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
      testConnectionMock.mockResolvedValue({ outcome: "verified", valid: true });

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
        valid: false,
        // Spelled out whole, the way `ProviderKeyInvalidError` serializes.
        // The abbreviated literal this used to carry — a `code`, a `message`
        // and nothing else — is not a shape the wire can produce, and
        // `message` is not even read: `explainSerializedError` looks the copy
        // up by `code`.
        domainError: {
          code: "provider_key_invalid",
          kind: "provider_key_invalid",
          retryable: false,
          meta: { provider: "openai" },
          traceId: undefined,
          spanId: undefined,
          httpStatus: 400,
          fault: "customer",
          reasons: [],
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
        valid: true,
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
        valid: true,
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

  describe("when the credential may have changed underneath the verdict", () => {
    /** @scenario "A verdict does not outlive the credential it was about" */
    it("forgets a green verdict rather than letting it stand over a new key", async () => {
      // The failure this exists to stop: test a provider, see "Connection
      // works", then edit the row and paste a bad key. The row's id does not
      // change, so without this the green verdict survives the save and makes
      // a success claim about a credential nothing ever checked.
      testConnectionMock.mockResolvedValue({ outcome: "verified", valid: true });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test(PROVIDER_ROW);
      });
      await waitFor(() => {
        expect(result.current.results[PROVIDER_ROW]?.status).toBe("works");
      });

      act(() => {
        result.current.clearResults();
      });

      expect(result.current.results[PROVIDER_ROW]).toBeUndefined();
    });

    /** @scenario "A verdict in flight when the credential changes is discarded" */
    it("discards a verdict that arrives after the credential may have changed", async () => {
      // The ordering that matters, and the one clearing alone does not cover:
      // the probe is already in flight when the row is edited. Emptying the map
      // does nothing to a promise that has not resolved yet, so its answer —
      // about the key that was there before — lands a moment later and stands.
      let settle!: (value: ModelProviderCredentialVerdict) => void;
      testConnectionMock.mockImplementation(
        () =>
          new Promise<ModelProviderCredentialVerdict>((resolve) => {
            settle = resolve;
          }),
      );

      const { result } = renderTest();
      let inFlight!: Promise<void>;
      act(() => {
        inFlight = result.current.test(PROVIDER_ROW);
      });

      act(() => {
        result.current.clearResults();
      });

      await act(async () => {
        settle({ outcome: "verified", valid: true });
        await inFlight;
      });

      expect(result.current.results[PROVIDER_ROW]).toBeUndefined();
    });

    /** @scenario "A verdict does not outlive the credential it was about" */
    it("forgets every row at once, not only the one just tested", async () => {
      testConnectionMock.mockResolvedValue({ outcome: "verified", valid: true });

      const { result } = renderTest();
      await act(async () => {
        await result.current.test("mp_a");
      });
      await act(async () => {
        await result.current.test("mp_b");
      });

      act(() => {
        result.current.clearResults();
      });

      expect(result.current.results).toEqual({});
    });
  });

  describe("when several rows are tested", () => {
    it("keeps each row's verdict to itself", async () => {
      testConnectionMock.mockResolvedValueOnce({ outcome: "verified", valid: true });
      testConnectionMock.mockResolvedValueOnce({
        outcome: "unchecked",
        valid: true,
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
