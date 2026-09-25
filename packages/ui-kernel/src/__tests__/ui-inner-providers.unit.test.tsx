import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { createUiInnerProvider, type UiPublicTelemetry } from "../ui-inner-providers.tsx";

let root: Root | undefined;

const publicAppConfig: UiPublicTelemetry = {
  mode: "test",
  telemetry: { browserTracing: false, sampleRatio: 0 },
};

afterEach(async () => {
  act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("given the providers that need router context", () => {
  describe("when the application installs the ones it still owns", () => {
    it("keeps the page inside the command bar, with the toaster beside it and the footer after it", async () => {
      const navigationWrites: string[] = [];
      const InnerProvider = createUiInnerProvider({
        usePublicAppConfig: () => ({ data: publicAppConfig }),
        useNavigationTracking: () => {
          navigationWrites.push("mounted");
        },
        commandBar: ({ children }: { children: ReactNode }) => (
          <div data-testid="command-bar">{children}</div>
        ),
        toaster: () => <div data-testid="toaster" />,
        footer: () => <div data-testid="footer" />,
        isDevelopment: false,
      });
      const router = createMemoryRouter(
        [
          {
            path: "/",
            Component: () => (
              <InnerProvider>
                <div data-testid="routed-content">LangWatch</div>
              </InnerProvider>
            ),
          },
        ],
        { initialEntries: ["/"] },
      );
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      act(() => {
        root?.render(<RouterProvider router={router} />);
      });

      expect(
        container.querySelector("[data-testid='command-bar'] [data-testid='routed-content']")
          ?.textContent,
      ).toBe("LangWatch");
      expect(
        container.querySelector("[data-testid='command-bar'] [data-testid='toaster']"),
      ).toBeTruthy();
      expect(
        container.querySelector("[data-testid='command-bar'] [data-testid='footer']"),
      ).toBeNull();
      expect(container.querySelector("[data-testid='footer']")).toBeTruthy();
      expect(navigationWrites).toEqual(["mounted"]);

      router.dispose();
    });
  });
});
