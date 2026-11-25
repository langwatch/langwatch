/**
 * @vitest-environment jsdom
 *
 * Inviting onto the Developer seat (ADR-171) sends no team, because a Developer joins none.
 * @see specs/members/developer-seat.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

import { AddMembersForm } from "../../sections/add-members-form.tsx";

const TEAM = { label: "Platform", value: "team-1" };

const renderForm = () => {
  const onSubmit = vi.fn();
  render(
    <DesignSystemProvider forcedTheme="light">
      <AddMembersForm
        teamOptions={[TEAM]}
        organizationId="org-1"
        onSubmit={onSubmit}
        isLoading={false}
        hasEmailProvider={true}
        onClose={vi.fn()}
        isInviterAdmin={true}
        initialEmails=""
      />
    </DesignSystemProvider>,
  );
  return { onSubmit };
};

describe("AddMembersForm", () => {
  afterEach(() => cleanup());

  describe("given the invite is for a Developer", () => {
    /** @scenario An administrator invites a Developer while the plan is at its seat cap */
    it("hides the team assignment and sends the invitation with no team", async () => {
      const user = userEvent.setup();
      const { onSubmit } = renderForm();

      expect(screen.getByText("Team Assignments")).toBeInTheDocument();
      await user.click(screen.getByRole("combobox", { name: "Seat" }));
      await user.click(await screen.findByRole("option", { name: /Developer/ }));

      expect(screen.queryByText("Team Assignments")).toBeNull();
      expect(screen.getByTestId("developer-no-team")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText("alice@example.com, bob@example.com"), {
        target: { value: "dev@example.com" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Send invites/i }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        invites: [{ email: "dev@example.com", orgRole: "DEVELOPER", teams: [] }],
      });
    });
  });
});
