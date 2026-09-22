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
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivationCodesSection } from "../ActivationCodesSection";

const listResult: {
  data?: { codes: unknown[] };
  error: unknown;
  isLoading: boolean;
} = { data: { codes: [] }, error: null, isLoading: false };

let revokeOptions: { onError?: (error: unknown) => void } = {};

const showErrorToast = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    licenseRegistry: {
      activationCodes: {
        useQuery: () => ({ ...listResult, refetch: vi.fn() }),
      },
      revokeActivationCode: {
        useMutation: (options: { onError?: (error: unknown) => void }) => {
          revokeOptions = options;
          return { mutate: vi.fn(), isPending: false };
        },
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
    revokeOptions = {};
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
        renderSection();

        const error = new Error("boom");
        revokeOptions.onError?.(error);

        expect(showErrorToast).toHaveBeenCalledWith({
          error,
          fallbackTitle: "The activation code was not revoked",
        });
      });
    });
  });
});
