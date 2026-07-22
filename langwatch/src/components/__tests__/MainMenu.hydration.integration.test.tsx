/**
 * @vitest-environment jsdom
 *
 * @see specs/navigation/main-menu-compact-placeholders.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/[project]" }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "project-1", slug: "demo" },
    organization: { id: "organization-1" },
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: {} }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    annotation: {
      getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
    },
    ops: {
      getBadgeCounts: { useQuery: () => ({ data: undefined }) },
      getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
    },
    user: {
      isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
    },
  },
}));

vi.mock("~/components/messages/HeaderButtons", () => ({
  useTableView: () => ({ isTableView: false }),
}));

vi.mock("~/components/sidebar/CollapsibleMenuGroup", () => ({
  CollapsibleMenuGroup: ({ label }: { label: string }) => (
    <a href="/demo/simulations" aria-label={label} />
  ),
}));

vi.mock("~/components/sidebar/SideMenuLink", () => ({
  SideMenuLink: ({ label, href }: { label: string; href: string }) => (
    <a href={href} aria-label={label} />
  ),
}));

vi.mock("~/components/sidebar/UsageIndicator", () => ({
  UsageIndicator: () => null,
}));

import { MainMenu } from "../MainMenu";

const menu = (
  <ChakraProvider value={defaultSystem}>
    <MainMenu isCompact />
  </ChakraProvider>
);

describe("MainMenu compact hydration", () => {
  afterEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** @scenario MainMenu compact mode hydrates without invalid markup */
  it("hydrates the server markup without a React hydration error", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const container = document.createElement("div");
    container.innerHTML = renderToString(menu);
    document.body.appendChild(container);

    const root = hydrateRoot(container, menu);
    await act(async () => {
      await Promise.resolve();
    });

    const hydrationErrors = consoleError.mock.calls
      .flat()
      .map(String)
      .filter((message) =>
        /hydration|cannot be a descendant|server rendered html didn't match/i.test(
          message,
        ),
      );
    expect(hydrationErrors).toEqual([]);

    const observeToggle = container.querySelector(
      'button[aria-label="Collapse Observe"]',
    );
    expect(observeToggle).not.toBeNull();
    expect(observeToggle?.textContent).toBe("");

    await act(async () => root.unmount());
  });
});
