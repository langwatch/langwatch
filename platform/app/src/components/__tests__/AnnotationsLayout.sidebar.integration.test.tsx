/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * The annotations sidebar has to say which list is open.
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

const mocks = vi.hoisted(() => ({
  pathname: "/acme/annotations",
  isLiteMember: false,
  openDrawer: vi.fn(),
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  usePathname: () => mocks.pathname,
}));
vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: { user: { name: "Ana Silva" } } }),
}));
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1", slug: "acme" } }),
}));
vi.mock("~/hooks/useLiteMemberGuard", () => ({
  useLiteMemberGuard: () => ({ isLiteMember: mocks.isLiteMember }),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer }),
}));
vi.mock("~/components/DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@langwatch/langy-web", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  LangyContextTarget: ({ children }: { children: ReactElement }) => children,
}));
// The link only renders the highlight; what is under test is the layout
// deciding which entry is the current one.
vi.mock("~/components/MenuLink", () => ({
  MenuLink: ({
    href,
    children,
    isSelectedAnnotation,
  }: {
    href: string;
    children: ReactNode;
    isSelectedAnnotation?: boolean;
  }) => (
    <a
      href={href}
      data-testid={`menu-link-${href}`}
      data-selected={String(!!isSelectedAnnotation)}
    >
      {children}
    </a>
  ),
}));
vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
      getAssignedItemsCount: { useQuery: () => ({ data: 0 }) },
      getQueueItemsCounts: {
        useQuery: () => ({
          data: [
            {
              id: "q1",
              slug: "support-reviews",
              name: "Support reviews",
              pendingCount: 2,
            },
            {
              id: "q2",
              slug: "sales-reviews",
              name: "Sales reviews",
              pendingCount: 0,
            },
          ],
        }),
      },
    },
  },
}));

import AnnotationsLayout from "../AnnotationsLayout";

const renderLayout = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AnnotationsLayout>
        <div>page</div>
      </AnnotationsLayout>
    </ChakraProvider>,
  );

const selected = (href: string) =>
  screen.getByTestId(`menu-link-${href}`).getAttribute("data-selected");

beforeEach(() => {
  mocks.pathname = "/acme/annotations";
  mocks.isLiteMember = false;
  mocks.openDrawer.mockClear();
});
afterEach(cleanup);

describe("AnnotationsLayout sidebar", () => {
  describe("given the reviewer is reading a queue", () => {
    /** @scenario "The open queue is the highlighted sidebar entry" */
    it("highlights that queue and no other", () => {
      mocks.pathname = "/acme/annotations/support-reviews";
      renderLayout();

      expect(selected("/acme/annotations/support-reviews")).toBe("true");
      expect(selected("/acme/annotations/sales-reviews")).toBe("false");
      expect(selected("/acme/annotations")).toBe("false");
    });
  });

  describe("given the reviewer is reading the all annotations page", () => {
    /** @scenario "The open top-level list is the highlighted sidebar entry" */
    it("highlights All and leaves the inbox alone", () => {
      mocks.pathname = "/acme/annotations/all";
      renderLayout();

      expect(selected("/acme/annotations/all")).toBe("true");
      expect(selected("/acme/annotations")).toBe("false");
      expect(selected("/acme/annotations/me")).toBe("false");
    });
  });

  describe("when the sidebar lists the reviewer's queues", () => {
    /** @scenario "Every queue in the sidebar carries its own actions menu" */
    it("gives each queue a menu that edits that queue", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      renderLayout();

      expect(
        screen.getByRole("button", { name: "Actions for queue Sales reviews" }),
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", {
          name: "Actions for queue Support reviews",
        }),
      );
      await user.click(await screen.findByText("Edit queue"));

      expect(mocks.openDrawer).toHaveBeenCalledWith("addAnnotationQueue", {
        queueId: "q1",
      });
    });
  });

  describe("given the reviewer cannot change resources", () => {
    /** @scenario "A member who cannot change resources is offered no queue actions" */
    it("offers no queue actions", () => {
      mocks.isLiteMember = true;
      renderLayout();

      expect(
        screen.queryByRole("button", { name: /Actions for queue/ }),
      ).not.toBeInTheDocument();
    });
  });
});
