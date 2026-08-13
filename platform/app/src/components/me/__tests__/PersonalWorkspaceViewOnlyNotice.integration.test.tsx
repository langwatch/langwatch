/**
 * @vitest-environment jsdom
 *
 * Why a Lite Member's own workspace keeps nothing they add.
 *
 * Their organization role caps what any of their role bindings can do, the admin
 * binding on their own workspace included, so reads work and writes do not. The
 * page renders in full either way and only the save fails, which reads as broken
 * rather than restricted unless the workspace says so itself.
 *
 * Spec: specs/ai-gateway/governance/personal-workspace-integrity.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";

const { mockOrganizationRole } = vi.hoisted(() => ({
  mockOrganizationRole: {
    current: null as OrganizationUserRole | null,
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organizationRole: mockOrganizationRole.current,
  }),
}));

import { PersonalWorkspaceViewOnlyNotice } from "../PersonalWorkspaceViewOnlyNotice";

const renderNotice = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <PersonalWorkspaceViewOnlyNotice />
    </ChakraProvider>,
  );

describe("given a member opening their own personal workspace", () => {
  afterEach(() => {
    cleanup();
    mockOrganizationRole.current = null;
  });

  describe("when their organization has them on a Lite Member seat", () => {
    /** @scenario A Lite Member is told why their own workspace takes nothing */
    it("tells them their access is view-only and who can change that", () => {
      mockOrganizationRole.current = OrganizationUserRole.EXTERNAL;

      renderNotice();

      const notice = screen.getByTestId(
        "personal-workspace-view-only-notice",
      ).textContent;
      expect(notice).toContain("view-only access");
      expect(notice).toContain("organization admin");
    });

    /** @scenario A Lite Member is told why their own workspace takes nothing */
    it("says nothing about how the restriction is implemented", () => {
      mockOrganizationRole.current = OrganizationUserRole.EXTERNAL;

      renderNotice();

      // Copy says what it means for the reader, never our vocabulary for it:
      // "EXTERNAL", "role binding" and "permission" are all ours, not theirs.
      const notice = screen.getByTestId(
        "personal-workspace-view-only-notice",
      ).textContent;
      expect(notice).not.toMatch(/EXTERNAL|binding|permission|RBAC/i);
    });
  });

  describe.each([
    OrganizationUserRole.MEMBER,
    OrganizationUserRole.ADMIN,
  ])("when they hold full access as %s", (role) => {
    /** @scenario A Lite Member is told why their own workspace takes nothing */
    it("says nothing at all", () => {
      mockOrganizationRole.current = role;

      const { container } = renderNotice();

      expect(container).toBeEmptyDOMElement();
    });
  });
});
