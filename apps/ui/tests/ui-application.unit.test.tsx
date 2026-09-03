import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UiSessionPort, useUiCapabilities } from "../src/behavior/ui-capabilities";
import { uiRoutePageKeys, type UiPageLoaderRegistry } from "../src/behavior/ui-page-loaders";
import type { UiFeatureApiTransport } from "../src/behavior/ui-feature-transport";
import type { PublicEnvironment } from "../src/model/public-environment";
import { uiRouteTable } from "../src/model/ui-route-table";
import {
  createUiApplication,
  type UiApplicationInstall,
  type UiFeatureInstall,
} from "../src/ui/sections/ui-application";

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

function PassThrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const providers: UiApplicationInstall["providers"] = {
  attribution: PassThrough,
  session: PassThrough,
  transport: PassThrough,
  graphicsQuality: PassThrough,
  commandBar: PassThrough,
  toaster: () => null,
  footer: () => null,
  usePublicEnvironment: () => ({ data: publicEnvironment }),
  useNavigationTracking: () => void 0,
  isDevelopment: false,
};

class StubSession extends UiSessionPort {
  currentUser() {
    return { id: "user_1", name: "Ada", email: "ada@example.com", image: null };
  }

  activeScope() {
    return { organizationId: "org_1", projectId: "project_1" };
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }

  featureFlag(): boolean | undefined {
    return true;
  }
}

/** The host's registry: one loader for every page key the route table names. */
function hostLoaders(page: ComponentType): UiPageLoaderRegistry {
  const registry: Record<string, () => Promise<{ default: ComponentType }>> = {};
  for (const key of uiRoutePageKeys(uiRouteTable)) {
    registry[key] = async () => ({ default: page });
  }
  return registry;
}

function applicationOf({
  loaders,
  features,
}: {
  loaders: UiPageLoaderRegistry;
  features?: UiFeatureInstall;
}) {
  return createUiApplication({
    providers,
    pages: {
      loaders,
      errorFallback: () => <div data-testid="page-error" />,
      rootErrorBoundary: () => <div data-testid="root-error" />,
    },
    ...(features ? { features } : {}),
  });
}

let dispose: (() => void) | undefined;

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  dispose?.();
  dispose = void 0;
  document.body.replaceChildren();
});

describe("given an application composed of pages apps/ui serves and pages the host still serves", () => {
  describe("when both halves register the same page key", () => {
    it("routes to the apps/ui page, inside a shell that answers its capabilities", async () => {
      function HostHome() {
        return <div data-testid="page">host</div>;
      }
      function OwnHome() {
        return <div data-testid="page">own:{useUiCapabilities().session.currentUser()?.id}</div>;
      }

      const application = applicationOf({
        loaders: hostLoaders(HostHome),
        features: {
          loaders: { "pages/index": async () => ({ default: OwnHome }) },
          capabilities: { session: new StubSession() },
          transport: {} as UiFeatureApiTransport,
        },
      });
      const view = render(<RouterProvider router={application.router} />);
      dispose = () => {
        view.unmount();
        application.router.dispose();
      };

      expect((await view.findByTestId("page")).textContent).toBe("own:user_1");
    });
  });

  describe("when only the host registers a page key", () => {
    it("keeps serving that page from the host registry", async () => {
      function HostPage() {
        return <div data-testid="page">host</div>;
      }

      const application = applicationOf({
        loaders: hostLoaders(HostPage),
        features: { loaders: { "pages/index": async () => ({ default: () => null }) } },
      });
      dispose = () => application.router.dispose();

      const signup = application.router.routes[0]?.children?.find(
        (route) => route.path === "/auth/signup",
      );
      const load = signup?.lazy;
      if (typeof load !== "function") throw new Error("the route carries no lazy loader");

      expect(await load()).toEqual({ Component: HostPage });
    });
  });

  describe("when neither half registers a page key the route table names", () => {
    it("refuses to compose the application and names the key", () => {
      const loaders = hostLoaders(() => null);
      const { "pages/index": _missing, ...withoutHome } = loaders;

      expect(() => applicationOf({ loaders: withoutHome })).toThrow(
        'No page loader is registered for route page "pages/index".',
      );
    });
  });
});
