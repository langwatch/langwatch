/**
 * @vitest-environment jsdom
 *
 * Issuing an activation code from the backoffice. The code is the connected
 * path, so the hosted services the license may call are on the form and every
 * one starts included.
 *
 * Spec: specs/self-hosting/connected-services/activation-codes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueActivationCodeDrawer } from "../IssueActivationCodeDrawer";

const mutate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    licenseRegistry: {
      issueActivationCode: {
        useMutation: () => ({
          mutate,
          isPending: false,
          error: null,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

vi.mock("~/features/errors", () => ({
  HandledErrorAlert: () => null,
}));

function renderDrawer() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IssueActivationCodeDrawer open={true} onClose={() => undefined} />
    </ChakraProvider>,
  );
}

async function fillCustomer() {
  fireEvent.change(
    await screen.findByRole("textbox", { name: "Customer organization id" }),
    { target: { value: "org_acme" } },
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Customer name" }), {
    target: { value: "ACME" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Contact email" }), {
    target: { value: "ops@acme.test" },
  });
}

describe("IssueActivationCodeDrawer", () => {
  describe("given an operator issuing an activation code in the backoffice", () => {
    describe("when the operator fills in the customer and issues the code", () => {
      /** @scenario "A code names the hosted services the license may call" */
      it("includes every hosted service unless the operator unticks it", async () => {
        mutate.mockClear();
        renderDrawer();
        await fillCustomer();

        expect(
          screen.getByRole("checkbox", { name: "Instant Evals" }),
        ).toBeChecked();
        expect(
          screen.getByRole("checkbox", { name: "Managed models" }),
        ).toBeChecked();

        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate.mock.calls[0]?.[0]).toMatchObject({
          organizationId: "org_acme",
          services: ["instant_evals", "managed_models"],
        });

        fireEvent.click(
          screen.getByRole("checkbox", { name: "Managed models" }),
        );
        await waitFor(() =>
          expect(
            screen.getByRole("checkbox", { name: "Managed models" }),
          ).not.toBeChecked(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
        expect(mutate.mock.calls[1]?.[0]).toMatchObject({
          services: ["instant_evals"],
        });
      });
    });
  });
});
