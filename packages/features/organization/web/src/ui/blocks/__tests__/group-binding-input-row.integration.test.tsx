/**
 * @vitest-environment jsdom
 *
 * See specs/members/member-access-editing.feature, "The Lite Member seat
 * ceiling". The BindingInputRow is where access rows are picked, so what it
 * offers is the policy the member dialog enforces: a Lite Member seat offers
 * the Viewer role only, no custom roles, and no organization scope. The group
 * editors render the same row with no seat, and must keep every role.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "../../../model/prisma-types";
import { BindingInputRow } from "../group-binding-input-row";

vi.mock("../../../behavior/organization-api", () => ({
  api: {
    team: {
      getTeamsWithMembers: {
        useQuery: () => ({
          data: [{ id: "team-1", name: "Team One", projects: [] }],
          isLoading: false,
        }),
      },
    },
    role: {
      getAll: {
        useQuery: () => ({
          data: [{ id: "role-1", name: "Data Scientist" }],
          isLoading: false,
        }),
      },
    },
  },
}));

vi.mock("../../../behavior/organization-feedback", () => ({
  useOrganizationToaster: () => ({ create: vi.fn() }),
  useShowErrorToast: () => vi.fn(),
}));

vi.mock("../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({ organization: { name: "Acme" } }),
}));

const Wrapper = ({ children }: { children?: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderRow(
  overrides: Partial<ComponentProps<typeof BindingInputRow>> = {},
) {
  return render(
    <BindingInputRow organizationId="org-1" onAdd={vi.fn()} {...overrides} />,
    { wrapper: Wrapper },
  );
}

/** The role picker is the first select in the row: role, then scope type. */
const rolePicker = () => screen.getAllByRole("combobox")[0]!;
const scopeTypePicker = () => screen.getAllByRole("combobox")[1]!;

describe("<BindingInputRow/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when no seat is passed, the group editors' shape", () => {
    /** @scenario The group access editor keeps every role available */
    it("offers every built-in role and the custom roles", async () => {
      const user = userEvent.setup();
      renderRow();

      await user.click(rolePicker());
      const listbox = await screen.findByRole("listbox");

      for (const label of ["Admin", "Member", "Viewer", "Data Scientist"]) {
        expect(
          within(listbox).getByRole("option", { name: label }),
        ).toBeTruthy();
      }
    });

    /** @scenario The group access editor keeps every role available */
    it("keeps the organization scope available", async () => {
      const user = userEvent.setup();
      renderRow();

      await user.click(scopeTypePicker());
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).getByRole("option", { name: "Organization" }),
      ).toBeTruthy();
    });

    it("starts from the Member role", () => {
      renderRow();
      expect(rolePicker().textContent).toContain("Member");
    });
  });

  describe("when the member is on a Lite Member seat", () => {
    /** @scenario The dialog offers only the Viewer role for a member on a Lite Member seat */
    it("offers the Viewer role and nothing above it", async () => {
      const user = userEvent.setup();
      renderRow({ organizationRole: OrganizationUserRole.EXTERNAL });

      await user.click(rolePicker());
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).getByRole("option", { name: "Viewer" }),
      ).toBeTruthy();
      expect(
        within(listbox).queryByRole("option", { name: "Admin" }),
      ).toBeNull();
      expect(
        within(listbox).queryByRole("option", { name: "Member" }),
      ).toBeNull();
    });

    /** @scenario Custom roles are not offered for a member on a Lite Member seat */
    it("offers no custom roles", async () => {
      const user = userEvent.setup();
      renderRow({ organizationRole: OrganizationUserRole.EXTERNAL });

      await user.click(rolePicker());
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).queryByRole("option", { name: "Data Scientist" }),
      ).toBeNull();
    });

    /** @scenario The dialog offers only the Viewer role for a member on a Lite Member seat */
    it("starts from the Viewer role", () => {
      renderRow({ organizationRole: OrganizationUserRole.EXTERNAL });
      expect(rolePicker().textContent).toContain("Viewer");
    });

    it("does not offer the organization scope", async () => {
      const user = userEvent.setup();
      renderRow({ organizationRole: OrganizationUserRole.EXTERNAL });

      await user.click(scopeTypePicker());
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).queryByRole("option", { name: "Organization" }),
      ).toBeNull();
      expect(
        within(listbox).getByRole("option", { name: "Team" }),
      ).toBeTruthy();
      expect(
        within(listbox).getByRole("option", { name: "Project" }),
      ).toBeTruthy();
    });
  });

  describe("when the seat switches to Lite Member mid-edit", () => {
    /** @scenario Staged access rows correct to Viewer when the seat switches to Lite Member */
    it("snaps a selection above the seat down to Viewer", async () => {
      const user = userEvent.setup();
      const { rerender } = renderRow({
        organizationRole: OrganizationUserRole.MEMBER,
      });

      await user.click(rolePicker());
      const listbox = await screen.findByRole("listbox");
      await user.click(within(listbox).getByRole("option", { name: "Admin" }));
      expect(rolePicker().textContent).toContain("Admin");

      rerender(
        <BindingInputRow
          organizationId="org-1"
          onAdd={vi.fn()}
          organizationRole={OrganizationUserRole.EXTERNAL}
        />,
      );

      expect(rolePicker().textContent).toContain("Viewer");
    });
  });
});
