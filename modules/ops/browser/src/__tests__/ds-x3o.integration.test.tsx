/** @vitest-environment jsdom */
/**
 * The new-license drawer validates on submit: Issue stays clickable, every missing field is named
 * and the first one takes focus, and nothing is sent until the form is whole.
 * Spec: specs/self-hosting/connected-services/license-registry.feature
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LicenseIssueDrawer } from "../features/admin/ui/sections/license-issue-drawer.tsx";
import { renderWithOpsHost } from "../testing.tsx";

const issue = vi.fn();
const registerLegacy = vi.fn();

vi.mock("../behavior/ops-api.ts", () => ({
  api: {
    useContext: () => ({ licenseRegistry: { invalidate: vi.fn().mockResolvedValue(undefined) } }),
    licenseRegistry: {
      issue: { useMutation: () => ({ mutate: issue, isPending: false }) },
      registerLegacy: { useMutation: () => ({ mutate: registerLegacy, isPending: false }) },
      revoke: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      resetInstanceBinding: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateTerms: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      linkToOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      changeSeats: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      reissue: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

function renderDrawer() {
  return renderWithOpsHost(<LicenseIssueDrawer open={true} onClose={() => undefined} />);
}

describe("LicenseIssueDrawer", () => {
  beforeEach(() => {
    issue.mockClear();
    registerLegacy.mockClear();
  });

  describe("given an operator issuing a license in the admin console", () => {
    describe("when they press Issue with the form empty", () => {
      /** @scenario A license issued from the admin console is recorded */
      it("names every missing field, focuses the first and sends nothing", async () => {
        renderDrawer();

        const submit = await screen.findByRole("button", { name: "Issue license" });
        await waitFor(() => expect(screen.getByRole("dialog")).toHaveFocus());
        expect(submit).toBeEnabled();
        fireEvent.click(submit);

        expect(await screen.findByText("Enter the organization id.")).toBeTruthy();
        expect(screen.getByText("Enter a contact email.")).toBeTruthy();
        expect(screen.getByText("Choose when the term ends.")).toBeTruthy();
        await waitFor(() =>
          expect(screen.getByPlaceholderText("Organization id on LangWatch Cloud")).toHaveFocus(),
        );
        expect(issue).not.toHaveBeenCalled();
      });
    });

    describe("when they complete the form and press Issue", () => {
      /** @scenario A license issued from the admin console is recorded */
      it("sends the license once the form is whole", async () => {
        renderDrawer();

        fireEvent.change(await screen.findByPlaceholderText("Organization id on LangWatch Cloud"), {
          target: { value: "org_acme" },
        });
        fireEvent.change(screen.getByLabelText(/Contact email/), {
          target: { value: "ops@acme.test" },
        });
        fireEvent.change(screen.getByLabelText(/Term ends/), { target: { value: "2027-01-01" } });
        fireEvent.click(screen.getByRole("button", { name: "Issue license" }));

        await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
        expect(issue.mock.calls[0]?.[0]).toMatchObject({
          customer: { organizationId: "org_acme" },
          email: "ops@acme.test",
        });
      });
    });
  });
});
