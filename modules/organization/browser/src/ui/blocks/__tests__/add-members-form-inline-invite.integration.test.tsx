/**
 * @vitest-environment jsdom
 *
 * The inline invite box hands its first letter to the drawer, which must take the typing over.
 * @see modules/organization/specs/invitations.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/organization-api.ts", () => ({
  api: {
    role: { getAll: { useQuery: () => ({ data: [] }) } },
  },
}));

import { AddMembersForm } from "../../sections/add-members-form.tsx";

describe("AddMembersForm", () => {
  afterEach(() => cleanup());

  describe("given it opens with an address begun in the inline invite box", () => {
    /** @scenario The invite drawer opened from the inline box takes the typing over */
    it("seeds the email field and focuses it", async () => {
      render(
        <DesignSystemProvider forcedTheme="light">
          <AddMembersForm
            teamOptions={[]}
            organizationId="org-1"
            onSubmit={vi.fn()}
            hasEmailProvider={true}
            initialEmails="a"
          />
        </DesignSystemProvider>,
      );

      const field = screen.getByTestId("members-invite-emails");
      expect(field).toHaveValue("a");
      await waitFor(() => expect(field).toHaveFocus());
    });
  });
});
