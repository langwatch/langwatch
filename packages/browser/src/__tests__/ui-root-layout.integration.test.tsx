// @vitest-environment jsdom
/**
 * Spec: specs/ui/boot-recovery.feature
 */
import { UI_BOOT_EVENTS } from "@langwatch/browser-host/navigation";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createUiRootLayout } from "../ui-root-layout.tsx";

function PassThrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const UiRootLayout = createUiRootLayout({
  innerProvider: PassThrough,
  featureShell: PassThrough,
  pageErrorFallback: () => null,
});

const heard = vi.fn();

afterEach(() => {
  window.removeEventListener(UI_BOOT_EVENTS.mounted, heard);
  heard.mockReset();
});

describe("given the first page loads", () => {
  describe("when it shows", () => {
    /** @scenario "The first page clears the counter" */
    it("tells the boot recovery once", async () => {
      window.addEventListener(UI_BOOT_EVENTS.mounted, heard);
      const router = createMemoryRouter([
        {
          path: "/",
          Component: UiRootLayout,
          children: [{ index: true, Component: () => <span>the page</span> }],
        },
      ]);

      render(<RouterProvider router={router} />);

      expect(await screen.findByText("the page")).toBeTruthy();
      expect(heard).toHaveBeenCalledTimes(1);
    });
  });
});
