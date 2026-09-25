import { UiSession, useUiCapabilities } from "@langwatch/browser-host/capabilities";
import type { UiFeatureApiTransport } from "@langwatch/browser-host/transport";
import { createUiApplication, type UiApplicationInstall } from "@langwatch/ui-kernel/application";
import {
  type UiFeatureInstall,
  uiRoutePageKeys,
  type UiPageLoaderRegistry,
} from "@langwatch/ui-kernel/feature-install";
import type { UiPublicTelemetry } from "@langwatch/ui-kernel/inner-providers";
import { render } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { Outlet } from "react-router";
import type { RouteObject } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";

const publicAppConfig: UiPublicTelemetry = {
  mode: "test",
  telemetry: { browserTracing: false, sampleRatio: 0 },
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
  usePublicAppConfig: () => ({ data: publicAppConfig }),
  useNavigationTracking: () => void 0,
  isDevelopment: false,
};

class StubSession extends UiSession {
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
      table: uiRouteTable,
      shellLayouts: {
        auth: async () => ({ default: () => <Outlet /> }),
        chrome: async () => ({ default: () => <Outlet /> }),
      },
      loaders,
      errorFallback: () => <div data-testid="page-error" />,
      rootErrorBoundary: () => <div data-testid="root-error" />,
    },
    ...(features ? { features } : {}),
    sessionQueryKey: ["test", "session"],
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

/** The route at a path, wherever the table nests it — auth sits under its own layout. */
function routeAt(routes: readonly RouteObject[], path: string): RouteObject | undefined {
  for (const route of routes) {
    if (route.path === path) return route;
    const found = route.children ? routeAt(route.children, path) : void 0;
    if (found) return found;
  }
  return void 0;
}

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

      const signup = routeAt(application.router.routes, "/auth/signup");
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
