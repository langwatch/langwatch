/** @vitest-environment jsdom */
/**
 * The activation-code list, when the reads and writes behind it fail.
 * Spec: specs/self-hosting/connected-services/activation-codes.feature
 */
import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeOpsHost, renderWithOpsHost, type FakeOpsHost } from "../../../testing.tsx";
import { ActivationCodesSection } from "../ui/sections/activation-codes-section.tsx";

const activeCode = {
  id: "ac_1",
  organizationName: "ACME",
  email: "ops@acme.test",
  codeHint: "G7H8",
  planType: "enterprise",
  maxMembers: 25,
  expiresAt: "2027-01-01T00:00:00.000Z",
  reusable: false,
  redemptionCount: 0,
  status: "active",
};

const listResult: { data?: { codes: unknown[] }; error: unknown; isLoading: boolean } = {
  data: { codes: [] },
  error: null,
  isLoading: false,
};

let revokeOutcome: "error" | "none" = "none";
const revokeError = new Error("boom");

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    licenseRegistry: {
      activationCodes: { useQuery: () => ({ ...listResult, refetch: vi.fn() }) },
      issueActivationCode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      revokeActivationCode: {
        useMutation: (options: { onError?: (error: unknown) => void }) => ({
          mutate: () => {
            if (revokeOutcome === "error") options.onError?.(revokeError);
          },
          isPending: false,
        }),
      },
    },
  },
}));

let host: FakeOpsHost;

function renderSection() {
  host = fakeOpsHost();
  return renderWithOpsHost(<ActivationCodesSection />, { host });
}

describe("ActivationCodesSection", () => {
  beforeEach(() => {
    listResult.data = { codes: [] };
    listResult.error = null;
    listResult.isLoading = false;
    revokeOutcome = "none";
  });

  describe("given an operator on the activation-code list in the backoffice", () => {
    describe("when the list of codes cannot be read", () => {
      /** @scenario A list of codes that cannot be read says so */
      it("names the failure instead of reading as an empty registry", () => {
        listResult.data = undefined;
        listResult.error = new Error("boom");

        renderSection();

        expect(screen.getByText("Couldn't load activation codes")).toBeTruthy();
        expect(screen.queryByText("No activation codes issued yet.")).toBeNull();
      });
    });

    describe("when revoking a code fails", () => {
      /** @scenario A revoke that fails tells the operator who asked for it */
      it("tells the operator rather than failing silently", () => {
        listResult.data = { codes: [activeCode] };
        revokeOutcome = "error";

        renderSection();
        fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

        expect(host.recording.failures).toEqual([
          { error: revokeError, fallbackTitle: "The activation code was not revoked" },
        ]);
      });
    });
  });
});
