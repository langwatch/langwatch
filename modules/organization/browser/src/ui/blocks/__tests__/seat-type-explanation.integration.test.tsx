/**
 * @vitest-environment jsdom
 *
 * Seat-type choice must be consistent across surfaces.
 * @see specs/licensing/seat-type-explained.feature
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SEAT_TYPE_COPY } from "../../../model/seat-type-copy.ts";
import { OrganizationUserRoleField } from "../../elements/organization-user-role-field.tsx";
import { AddMembersForm } from "../../sections/add-members-form.tsx";

const LITE_MEMBER_EXPLANATION = SEAT_TYPE_COPY.liteMemberExplanation;

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

const renderInviteForm = () =>
  render(
    <DesignSystemProvider forcedTheme="light">
      <AddMembersForm
        teamOptions={[{ label: "Engineering", value: "team-1" }]}
        organizationId="org-1"
        onSubmit={vi.fn()}
      />
    </DesignSystemProvider>,
  );

/** The invite form's seat picker, opened the way an admin opens it. */
const openSeatPicker = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox", { name: "Seat" }));
  return screen.findByRole("option", { name: /Lite Member/ });
};

describe("the seat-type choice", () => {
  describe("when an admin invites someone", () => {
    /** @scenario The invite form explains what a lite member can do */
    it("says a lite member can view but not change, right on the option", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      const liteOption = await openSeatPicker(user);

      expect(within(liteOption).getByText(/view the work, but not change it/i)).toBeDefined();
    });

    /** @scenario The invite form explains what a lite member can do */
    it("opens the full explanation without leaving the form", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      await openSeatPicker(user);
      await user.click(screen.getByTestId("lite-member-info"));

      const explanation = await screen.findByText(LITE_MEMBER_EXPLANATION);
      expect(explanation).toBeDefined();
      // Still on the form: the email field never went away.
      expect(screen.getByText("Email addresses")).toBeDefined();
    });

    /** @scenario The invite form explains what a lite member can do */
    it("names what they can see and says costs are not part of it", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      await openSeatPicker(user);
      await user.click(screen.getByTestId("lite-member-info"));
      const explanation = await screen.findByText(LITE_MEMBER_EXPLANATION);

      expect(explanation.textContent).toMatch(/traces/i);
      expect(explanation.textContent).toMatch(/analytics/i);
      expect(explanation.textContent).toMatch(/scenario runs/i);
      expect(explanation.textContent).toMatch(/cannot see costs/i);
    });
  });

  describe("when an admin reads what a lite member is", () => {
    const BILLING_WORDS = /billing|billed|invoice|charge|subscription|\bpay|price/i;

    /** @scenario "The explanation names capability rather than a billing switch" */
    it("describes them by what they can do, and never as a billing setting", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      const liteOption = await openSeatPicker(user);
      const short = within(liteOption).getByText(SEAT_TYPE_COPY.liteMemberShortDescription);
      expect(short.textContent).not.toMatch(BILLING_WORDS);

      await user.click(screen.getByTestId("lite-member-info"));
      const explanation = await screen.findByText(LITE_MEMBER_EXPLANATION);

      expect(explanation.textContent).toMatch(/can open the projects/i);
      expect(explanation.textContent).toMatch(/cannot create, edit or delete/i);
      expect(explanation.textContent).not.toMatch(BILLING_WORDS);
    });
  });

  describe("when an admin only wants to read the explanation", () => {
    /** @scenario Reading the explanation does not choose the seat */
    it("does not switch the member to a lite seat on the way", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <DesignSystemProvider forcedTheme="light">
          <OrganizationUserRoleField value="MEMBER" onChange={onChange} />
        </DesignSystemProvider>,
      );

      await user.click(screen.getByRole("combobox"));
      await user.click(await screen.findByTestId("lite-member-info"));

      // A select option commits on pointer-down, so an unguarded (i) inside one
      // answers "what is a lite member?" by making them one.
      expect(onChange).not.toHaveBeenCalled();
      expect(await screen.findByText(LITE_MEMBER_EXPLANATION)).toBeDefined();
    });

    /** @scenario Reading the explanation does not choose the seat */
    it("does not switch the invite form's seat to Lite Member", async () => {
      const user = userEvent.setup();
      renderInviteForm();

      const seat = () => screen.getByRole("combobox", { name: "Seat" });
      expect(seat().textContent).toContain("Member");
      expect(seat().textContent).not.toContain("Lite");

      await openSeatPicker(user);
      await user.click(screen.getByTestId("lite-member-info"));

      expect(await screen.findByText(LITE_MEMBER_EXPLANATION)).toBeDefined();
      expect(seat().textContent).not.toContain("Lite");
    });
  });

  describe("when an admin changes an existing member's role", () => {
    /** @scenario The role picker explains the same thing as the invite form */
    it("carries the same explanation the invite form shows", async () => {
      const user = userEvent.setup();
      render(
        <DesignSystemProvider forcedTheme="light">
          <OrganizationUserRoleField value="MEMBER" onChange={vi.fn()} />
        </DesignSystemProvider>,
      );

      await user.click(screen.getByRole("combobox"));
      await user.click(await screen.findByTestId("lite-member-info"));

      expect(await screen.findByText(LITE_MEMBER_EXPLANATION)).toBeDefined();
    });
  });
});
