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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/organization-api", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

import { AddMembersForm } from "../add-members-form";

const WARNING = "lite-member-needs-team-warning";
const TEAM = { label: "Research", value: "team-research" };
const EMAIL = "dana@example.com";

/**
 * Rendered with one team to choose from, which the form assigns up front —
 * the state the feature's Background describes. Each case that needs an empty
 * team list gets there the way an admin does, by removing that row, so the
 * warning is exercised on the path that leads to it.
 */
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

const markAsLiteMember = () => {
  fireEvent.click(screen.getByText("Lite Member"));
};

const removeTheAssignedTeam = () => {
  fireEvent.click(screen.getByLabelText("Remove team assignment"));
};

const enterEmail = (email: string) => {
  fireEvent.change(
    screen.getByPlaceholderText("alice@example.com, bob@example.com"),
    { target: { value: email } },
  );
};

const sendInvites = () => {
  fireEvent.click(screen.getByRole("button", { name: /Send invites/i }));
};

describe("AddMembersForm", () => {
  afterEach(cleanup);

  describe("given the invite is for a lite member", () => {
    describe("when a team is still assigned", () => {
      /** @scenario Inviting a Lite Member with no team warns that they will see nothing */
      it("says nothing, because the team is what they will see", () => {
        renderForm();

        markAsLiteMember();

        expect(screen.queryByTestId(WARNING)).toBeNull();
      });
    });

    describe("when the assigned team is removed", () => {
      /** @scenario Inviting a Lite Member with no team warns that they will see nothing */
      it("warns that the person will not be able to see anything", () => {
        renderForm();

        markAsLiteMember();
        removeTheAssignedTeam();

        expect(screen.getByTestId(WARNING)).toBeTruthy();
      });

      /** @scenario Inviting a Lite Member with no team warns that they will see nothing */
      it("names adding a team as the way out, and says it can wait", () => {
        renderForm();

        markAsLiteMember();
        removeTheAssignedTeam();

        const warning = screen.getByTestId(WARNING).textContent ?? "";
        expect(warning).toContain("Add a team");
        expect(warning).toContain("later");
      });

      /** @scenario The warning does not block the invitation */
      it("still sends the lite invitation with no team, because assigning one later is allowed", async () => {
        const { onSubmit } = renderForm();

        markAsLiteMember();
        removeTheAssignedTeam();
        enterEmail(EMAIL);
        sendInvites();

        await waitFor(() => {
          expect(onSubmit).toHaveBeenCalledWith({
            invites: [{ email: EMAIL, orgRole: "EXTERNAL", teams: [] }],
          });
        });
      });
    });
  });

  describe("given the invite is for a full member", () => {
    describe("when the assigned team is removed", () => {
      /** @scenario Inviting a full member with no team is not warned about */
      it("says nothing, because a full member holds access without a team", () => {
        renderForm();

        removeTheAssignedTeam();

        expect(screen.queryByTestId(WARNING)).toBeNull();
      });
    });
  });
});
