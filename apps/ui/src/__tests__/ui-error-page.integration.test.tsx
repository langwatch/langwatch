/**
 * What the application shows when a module host mount throws while rendering.
 * @vitest-environment jsdom
 * Spec: specs/frontend/app-error-page.feature
 */

import { createUiRootLayout } from "@langwatch/browser/root-layout";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { act, cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UiScreenErrorBoundary, uiErrorPages } from "../shell/ui-error-page";

const THROWN = "host mount exploded";

/** Stands where the module host stack renders: the root layout's feature shell. */
function ThrowingHostMount(): ReactNode {
  throw new Error(THROWN);
}

function ThrowingScreen(): ReactNode {
  throw new Error(THROWN);
}

/** Stands for the navigation shell: the chrome around the routed screen, as ui-app-chrome does. */
function StandInChrome() {
  return (
    <>
      <nav>sidebar and top bar</nav>
      <UiScreenErrorBoundary isDevelopment={false}>
        <Outlet />
      </UiScreenErrorBoundary>
    </>
  );
}

function Passthrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => void 0);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("given a module host mount that throws while rendering", () => {
  describe("when the application renders", () => {
    /** @scenario "A host mount that throws renders the branded error page" */
    it("shows the branded error page with Reload and Go home, and no raw message", async () => {
      const pages = uiErrorPages({ isDevelopment: false });
      const router = createMemoryRouter([
        {
          path: "/",
          Component: createUiRootLayout({
            innerProvider: Passthrough,
            featureShell: ThrowingHostMount,
            pageErrorFallback: pages.page,
          }),
          ErrorBoundary: pages.route,
          children: [{ index: true, Component: () => <p>home screen</p> }],
        },
      ]);

      renderWithDesignSystem(<RouterProvider router={router} />);

      expect(await screen.findByTestId("app-error-page")).toBeTruthy();
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Something went wrong");
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Go home" }).getAttribute("href")).toBe("/");
      expect(screen.queryByText("home screen")).toBeNull();
      expect(screen.queryByText(new RegExp(THROWN))).toBeNull();
      expect(screen.queryByTestId("app-error-stack")).toBeNull();
    });
  });
});

describe("given the reader is on a screen inside the application chrome", () => {
  describe("when the screen throws while rendering", () => {
    /** @scenario "A screen that throws shows the error card inside the chrome" */
    it("shows the error card in place of the screen, keeps the chrome, and resets on navigation", async () => {
      const router = createMemoryRouter(
        [
          {
            path: "/",
            Component: StandInChrome,
            children: [
              { path: "broken", Component: ThrowingScreen },
              { path: "fine", Component: () => <p>fine screen</p> },
            ],
          },
        ],
        { initialEntries: ["/broken"] },
      );

      renderWithDesignSystem(<RouterProvider router={router} />);

      expect(await screen.findByTestId("app-error-page")).toBeTruthy();
      expect(screen.getByText("sidebar and top bar")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
      expect(screen.queryByText(new RegExp(THROWN))).toBeNull();

      await act(() => router.navigate("/fine"));

      expect(await screen.findByText("fine screen")).toBeTruthy();
      expect(screen.queryByTestId("app-error-page")).toBeNull();
      expect(screen.getByText("sidebar and top bar")).toBeTruthy();
    });
  });
});
