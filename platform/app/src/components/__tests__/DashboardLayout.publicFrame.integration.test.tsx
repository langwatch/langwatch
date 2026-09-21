/**
 * @vitest-environment jsdom
 *
 * Spec: specs/navigation/navigation-modes.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ pathname: "/share/abc" }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({ data: null, status: "unauthenticated" }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { NODE_ENV: "test" } }),
}));

vi.mock("../AppHeaderUserMenu", () => ({
  AppHeaderUserMenu: ({ publicPage }: { publicPage?: boolean }) => (
    <div data-testid="avatar-menu" data-public={String(!!publicPage)} />
  ),
}));

vi.mock("../DashboardPageBody", () => ({
  DashboardPageBody: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="page-body">{children}</div>
  ),
}));

vi.mock("../../features/navigation/shell/NavigationV2Shell", () => ({
  NavigationV2Shell: () => (
    <div data-testid="navigation-v2-shell">SHOULD NOT RENDER</div>
  ),
}));

import { DashboardLayout } from "../DashboardLayout";

afterEach(() => cleanup());

describe("DashboardLayout on a public page", () => {
  /** @scenario A signed-out share page renders without the app chrome */
  it("renders the plain frame with a sign-in entry and no shell", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <DashboardLayout publicPage>
          <div data-testid="share-page">shared</div>
        </DashboardLayout>
      </ChakraProvider>,
    );

    expect(screen.getByTestId("share-page")).toBeInTheDocument();
    expect(screen.getByTestId("avatar-menu")).toHaveAttribute(
      "data-public",
      "true",
    );
    expect(screen.queryByTestId("navigation-v2-shell")).not.toBeInTheDocument();
  });
});
