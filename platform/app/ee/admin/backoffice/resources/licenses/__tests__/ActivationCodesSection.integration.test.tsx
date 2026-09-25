/**
 * @vitest-environment jsdom
 *
 * The activation-code list in the backoffice, when the reads and writes behind
 * it fail. A failed list must say so rather than read as an empty registry, and
 * a failed revoke must reach the operator who clicked it.
 *
 * Spec: specs/self-hosting/connected-services/activation-codes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivationCodesSection } from "../ActivationCodesSection";

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

const listResult: {
  data?: { codes: unknown[] };
  error: unknown;
  isLoading: boolean;
} = { data: { codes: [] }, error: null, isLoading: false };

/** What the mutation does when the component calls `mutate`. */
let revokeOutcome: "error" | "none" = "none";
const revokeError = new Error("boom");

const showErrorToast = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    licenseRegistry: {
      activationCodes: {
        useQuery: () => ({ ...listResult, refetch: vi.fn() }),
      },
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

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: ({ fallbackTitle }: { fallbackTitle: string }) => (
    <div>{fallbackTitle}</div>
  ),
  showErrorToast: (args: unknown) => showErrorToast(args),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("../IssueActivationCodeDrawer", () => ({
  IssueActivationCodeDrawer: () => null,
}));

function renderSection() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ActivationCodesSection />
    </ChakraProvider>,
  );
}

describe("ActivationCodesSection", () => {
  beforeEach(() => {
    listResult.data = { codes: [] };
    listResult.error = null;
    listResult.isLoading = false;
    revokeOutcome = "none";
    showErrorToast.mockClear();
  });

  describe("given an operator on the activation-code list in the backoffice", () => {
    describe("when the list of codes cannot be read", () => {
      /** @scenario "A list of codes that cannot be read says so" */
      it("names the failure instead of reading as an empty registry", () => {
        listResult.data = undefined;
        listResult.error = new Error("boom");

        renderSection();

        expect(
          screen.getByText("Couldn't load activation codes"),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("No activation codes issued yet."),
        ).not.toBeInTheDocument();
      });
    });

    describe("when revoking a code fails", () => {
      /** @scenario "A revoke that fails tells the operator who asked for it" */
      it("tells the operator rather than failing silently", () => {
        listResult.data = { codes: [activeCode] };
        revokeOutcome = "error";

        renderSection();
        fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

        expect(showErrorToast).toHaveBeenCalledWith({
          error: revokeError,
          fallbackTitle: "The activation code was not revoked",
        });
      });
    });
  });
});
