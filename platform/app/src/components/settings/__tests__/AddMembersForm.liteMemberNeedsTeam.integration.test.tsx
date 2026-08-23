/**
 * @vitest-environment jsdom
 *
 * Warning an admin about a lite invite that names no team.
 *
 * A lite seat carries no organization-wide access of its own: the invite
 * grants what its teams grant and nothing else. So a lite invite with no team
 * produces somebody who can sign in, see nothing, and still consume a seat —
 * and the admin finds out when the person tells them. The form says so before
 * they send it.
 *
 * A warning, not a refusal: assigning the team afterwards is a legitimate way
 * to work, and the admin is the one who knows whether they mean to.
 *
 * Spec: specs/members/member-role-team-restrictions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/api", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

import { AddMembersForm } from "../../AddMembersForm";

const WARNING = "lite-member-needs-team-warning";

/**
 * Rendered with no teams to choose from, which is the state that leaves the
 * team list empty and reachable — the same state an admin lands in by
 * removing the row the form starts with.
 */
const renderForm = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AddMembersForm
        teamOptions={[]}
        organizationId="org-1"
        onSubmit={vi.fn()}
        isLoading={false}
        hasEmailProvider={true}
        onClose={vi.fn()}
        isInviterAdmin={true}
        initialEmails=""
      />
    </ChakraProvider>,
  );

const markAsLiteMember = () => {
  fireEvent.click(screen.getByText("Lite Member"));
};

describe("AddMembersForm", () => {
  afterEach(cleanup);

  describe("given no team is assigned", () => {
    describe("when the invite is for a full member", () => {
      /** @scenario Inviting a full member with no team is not warned about */
      it("says nothing, because a full member holds access without a team", () => {
        renderForm();

        expect(screen.queryByTestId(WARNING)).toBeNull();
      });
    });

    describe("when the invite is for a lite member", () => {
      /** @scenario Inviting a Lite Member with no team warns that they will see nothing */
      it("warns that the person will not be able to see anything", () => {
        renderForm();

        markAsLiteMember();

        expect(screen.getByTestId(WARNING)).toBeTruthy();
      });

      /** @scenario Inviting a Lite Member with no team warns that they will see nothing */
      it("names adding a team as the way out, and says it can wait", () => {
        renderForm();

        markAsLiteMember();

        const warning = screen.getByTestId(WARNING).textContent ?? "";
        expect(warning).toContain("Add a team");
        expect(warning).toContain("later");
      });

      /** @scenario The warning does not block the invitation */
      it("still lets the invite be sent, because assigning the team later is allowed", () => {
        renderForm();

        markAsLiteMember();

        const submit = screen.getByRole("button", { name: /Send invites/i });
        expect(submit.hasAttribute("disabled")).toBe(false);
      });
    });
  });
});
