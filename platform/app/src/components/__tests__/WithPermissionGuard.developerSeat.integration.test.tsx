/**
 * @vitest-environment jsdom
 *
 * The seat gate on a page (ADR-143). A Developer holds a member's permissions
 * inside their own project, so a permission alone lets them onto a Gateway
 * page; the guard also asks whether their seat reaches the product the page
 * belongs to.
 *
 * Spec: specs/members/developer-seat.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let mockPathname = "/gateway/virtual-keys";
let mockOrganizationRole = "DEVELOPER";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: mockPathname, push: vi.fn() }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organizationRole: mockOrganizationRole,
    hasAnyPermission: () => true,
    hasPermission: () => true,
  }),
}));

const { withPermissionGuard } = await import("../WithPermissionGuard");

const Page = () => <div>the page</div>;

const renderGuarded = () => {
  const Guarded = withPermissionGuard("virtualKeys:view")(Page);
  render(
    <ChakraProvider value={defaultSystem}>
      <Guarded />
    </ChakraProvider>,
  );
};

describe("withPermissionGuard", () => {
  afterEach(() => {
    cleanup();
    mockPathname = "/gateway/virtual-keys";
    mockOrganizationRole = "DEVELOPER";
  });

  describe("given a Developer who holds the page's permission in their own project", () => {
    describe("when the page belongs to an organization-wide product", () => {
      /** @scenario A Developer cannot open an organisation-wide product by address */
      it("refuses the page", () => {
        renderGuarded();

        expect(screen.queryByText("the page")).toBeNull();
        expect(screen.getByText(/don't have permission/)).toBeInTheDocument();
      });
    });

    describe("when the page belongs to their own Me workspace", () => {
      /** @scenario A Developer cannot open an organisation-wide product by address */
      it("opens the page", () => {
        mockPathname = "/me/sessions";
        renderGuarded();

        expect(screen.getByText("the page")).toBeInTheDocument();
      });
    });
  });

  describe("given a Full member who holds the page's permission", () => {
    describe("when the page belongs to an organization-wide product", () => {
      it("opens the page, because the seat gate is for the Developer seat only", () => {
        mockOrganizationRole = "MEMBER";
        renderGuarded();

        expect(screen.getByText("the page")).toBeInTheDocument();
      });
    });
  });
});
