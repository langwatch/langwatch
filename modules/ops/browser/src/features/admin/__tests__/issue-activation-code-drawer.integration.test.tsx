/** @vitest-environment jsdom */
/**
 * Issuing an activation code from the backoffice: every hosted service starts included.
 * Spec: specs/self-hosting/connected-services/activation-codes.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithOpsHost } from "../../../testing.tsx";
import { IssueActivationCodeDrawer } from "../ui/sections/issue-activation-code-drawer.tsx";

const mutate = vi.fn();

vi.mock("../../../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    licenseRegistry: {
      issueActivationCode: { useMutation: () => ({ mutate, isPending: false }) },
      revokeActivationCode: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

function renderDrawer() {
  return renderWithOpsHost(<IssueActivationCodeDrawer open={true} onClose={() => undefined} />);
}

async function fillCustomer() {
  fireEvent.change(await screen.findByRole("textbox", { name: "Customer organization id" }), {
    target: { value: "org_acme" },
  });
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

        expect(screen.getByRole("checkbox", { name: "Instant evals" })).toBeChecked();
        expect(screen.getByRole("checkbox", { name: "Managed models" })).toBeChecked();

        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate.mock.calls[0]?.[0]).toMatchObject({
          organizationId: "org_acme",
          services: ["instant_evals", "managed_models"],
        });

        fireEvent.click(screen.getByRole("checkbox", { name: "Managed models" }));
        await waitFor(() =>
          expect(screen.getByRole("checkbox", { name: "Managed models" })).not.toBeChecked(),
        );
        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
        expect(mutate.mock.calls[1]?.[0]).toMatchObject({ services: ["instant_evals"] });
      });
    });

    describe("when the operator leaves lite seats empty, or types a number", () => {
      /** @scenario "The activation code form offers lite seats with the plan default" */
      it("sends no lite seats when empty, and the typed number otherwise", async () => {
        mutate.mockClear();
        renderDrawer();
        await fillCustomer();

        const lite = screen.getByRole("spinbutton", { name: "Lite member seats" });
        expect(lite).toHaveValue(null);
        expect(lite).toHaveAttribute("placeholder", "Plan default");

        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
        expect(mutate.mock.calls[0]?.[0]).not.toHaveProperty("maxMembersLite");

        fireEvent.change(lite, { target: { value: "7" } });
        fireEvent.click(screen.getByRole("button", { name: "Issue code" }));
        await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
        expect(mutate.mock.calls[1]?.[0]).toMatchObject({ maxMembersLite: 7 });
      });
    });
  });
});
