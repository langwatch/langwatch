/**
 * @vitest-environment jsdom
 *
 * See specs/licensing/seat-type-explained.feature.
 *
 * "Does this person need a full seat?" is a billing question, and admins were
 * answering it by asking their account manager. Both surfaces where the choice
 * is made have to carry the answer, and carry the same one.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddMembersForm } from "../add-members-form";
import { OrganizationUserRoleField } from "../../elements/organization-user-role-field";
import { LITE_MEMBER_EXPLANATION } from "@langwatch/enterprise-licensing-web";

vi.mock("../../../behavior/organization-api", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

const renderInviteForm = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddMembersForm
        teamOptions={[{ label: "Engineering", value: "team-1" }]}
        organizationId="org-1"
        onSubmit={vi.fn()}
      />
    </ChakraProvider>,
  );

describe("the seat-type choice", () => {
  describe("when an admin invites someone", () => {
    /** @scenario The invite form explains what a lite member can do */
    it("says a lite member can view but not change, right on the option", () => {
      renderInviteForm();

      const liteOption = screen.getByText("Lite Member").closest("label, div")!.parentElement!;
      expect(within(liteOption).getByText(/view the work, but not change it/i)).toBeDefined();
    });

    /** @scenario The invite form explains what a lite member can do */
    it("opens the full explanation without leaving the form", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      await user.click(screen.getByTestId("lite-member-info"));

      const explanation = await screen.findByText(LITE_MEMBER_EXPLANATION);
      expect(explanation).toBeDefined();
      // Still on the form: the email field never went away.
      expect(screen.getByText("Lite Member")).toBeDefined();
    });

    /** @scenario The invite form explains what a lite member can do */
    it("names what they can see and says costs are not part of it", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      await user.click(screen.getByTestId("lite-member-info"));
      const explanation = await screen.findByText(LITE_MEMBER_EXPLANATION);

      expect(explanation.textContent).toMatch(/traces/i);
      expect(explanation.textContent).toMatch(/analytics/i);
      expect(explanation.textContent).toMatch(/scenario runs/i);
      expect(explanation.textContent).toMatch(/cannot see costs/i);
    });
  });

  describe("when an admin only wants to read the explanation", () => {
    /** @scenario Reading the explanation does not choose the seat */
    it("does not switch the member to a lite seat on the way", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <ChakraProvider value={defaultSystem}>
          <OrganizationUserRoleField value="MEMBER" onChange={onChange} />
        </ChakraProvider>,
      );

      await user.click(screen.getByRole("combobox"));
      await user.click(await screen.findByTestId("lite-member-info"));

      // A select option commits on pointer-down, so an unguarded (i) inside one
      // answers "what is a lite member?" by making them one.
      expect(onChange).not.toHaveBeenCalled();
      expect(await screen.findByText(LITE_MEMBER_EXPLANATION)).toBeDefined();
    });

    /** @scenario Reading the explanation does not choose the seat */
    it("does not tick the lite member box on the invite form", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      const checkbox = () => screen.getByRole("checkbox") as HTMLInputElement;
      const before = checkbox().checked;
      await user.click(screen.getByTestId("lite-member-info"));

      expect(checkbox().checked).toBe(before);
    });
  });

  describe("when an admin changes an existing member's role", () => {
    /** @scenario The role picker explains the same thing as the invite form */
    it("carries the same explanation the invite form shows", async () => {
      const user = userEvent.setup();
      render(
        <ChakraProvider value={defaultSystem}>
          <OrganizationUserRoleField value="MEMBER" onChange={vi.fn()} />
        </ChakraProvider>,
      );

      await user.click(screen.getByRole("combobox"));
      await user.click(await screen.findByTestId("lite-member-info"));

      expect(await screen.findByText(LITE_MEMBER_EXPLANATION)).toBeDefined();
    });
  });
});
