import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { PublicEnvironment } from "../src/model/public-environment";
import { createUiInnerProvider } from "../src/ui/sections/ui-inner-providers";

let root: Root | undefined;

const publicEnvironment: PublicEnvironment = {
  BASE_HOST: "http://localhost",
  DEMO_PROJECT_SLUG: void 0,
  NODE_ENV: "test",
  IDENTITY_FRONT_DOOR: false,
  PASSKEYS_ENABLED: false,
  HAS_EMAIL_PROVIDER_KEY: false,
  IS_SAAS: false,
  GATEWAY_BASE_URL: "http://localhost:5563",
  POSTHOG_KEY: void 0,
  POSTHOG_HOST: void 0,
  RUM_ENABLED: false,
  RUM_SAMPLE_RATIO: 0,
  HAS_LANGWATCH_NLP_SERVICE: false,
  HAS_LANGEVALS_ENDPOINT: false,
  STRIPE_LICENSE_PAYMENT_LINK_URL: void 0,
};

afterEach(async () => {
  await act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("given the providers that need router context", () => {
  describe("when the application installs the ones it still owns", () => {
    it("keeps the page inside the command bar, with the toaster beside it and the footer after it", async () => {
      const navigationWrites: string[] = [];
      const InnerProvider = createUiInnerProvider({
        usePublicEnvironment: () => ({ data: publicEnvironment }),
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

      await act(() => {
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
