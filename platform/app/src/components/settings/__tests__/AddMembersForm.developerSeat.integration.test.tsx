/**
 * @vitest-environment jsdom
 *
 * Inviting somebody onto the Developer seat (ADR-143): the form offers it,
 * drops the team assignment when it is picked, and sends the invitation with
 * no team, because a Developer joins none.
 *
 * Spec: specs/members/developer-seat.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/api", () => ({
  api: {
    role: {
      getAll: { useQuery: () => ({ data: [] }) },
    },
  },
}));

const { AddMembersForm } = await import("../../AddMembersForm");

const TEAM = { label: "Platform", value: "team-1" };

const renderForm = () => {
  const onSubmit = vi.fn();
  render(
    <ChakraProvider value={defaultSystem}>
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
    </ChakraProvider>,
  );
  return { onSubmit };
};

describe("AddMembersForm", () => {
  afterEach(() => cleanup());

  describe("given the invite is for a Developer", () => {
    /** @scenario An administrator invites a Developer while the plan is at its seat cap */
    it("hides the team assignment and sends the invitation with no team", async () => {
      const { onSubmit } = renderForm();

      expect(screen.getByText("Team Assignments")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Developer"));

      expect(screen.queryByText("Team Assignments")).toBeNull();
      expect(screen.getByTestId("developer-no-team")).toBeInTheDocument();

      fireEvent.change(
        screen.getByPlaceholderText("alice@example.com, bob@example.com"),
        { target: { value: "dev@example.com" } },
      );
      fireEvent.click(screen.getByRole("button", { name: /Send invites/i }));

      await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        invites: [
          {
            email: "dev@example.com",
            orgRole: "DEVELOPER",
            teams: [],
          },
        ],
      });
    });
  });
});
