/**
 * The application a composing host actually gets from `@langwatch/ui`.
 */

import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { webModules } from "@langwatch/installed-web-modules";
import { createUiApplication } from "@langwatch/ui-kernel/application";
import { uiRoutePageKeys, type UiPageLoaderRegistry } from "@langwatch/ui-kernel/feature-install";
import { installedModuleScreens } from "@langwatch/ui-kernel/module-screens";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { uiRouteTable } from "../ui-route-table";

const publicAppConfig: PublicAppConfig = {
  appBaseUrl: "http://localhost",
  gatewayBaseUrl: "http://localhost:5563",
  deployment: "self-hosted",
  mode: "test",
  telemetry: { browserTracing: false, sampleRatio: 0 },
  capabilities: { email: false, nlp: false, langevals: false },
  passkeys: false,
  identityFrontDoor: false,
};

function PassThrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * A host registry missing governance's keys — a composition fault ONLY if
 * nothing else supplies them. Here `installedModuleScreens(webModules)`
 * does, exactly as `main.tsx` composes it (ARCHITECTURE §10.1, §11).
 */
function hostRegistryWithoutGovernance(): UiPageLoaderRegistry {
  const loaders: Record<string, () => Promise<{ default: () => null }>> = {};
  for (const key of uiRoutePageKeys(uiRouteTable)) {
    if (key.startsWith("pages/governance/")) continue;
    loaders[key] = async () => ({ default: () => null });
  }
  return loaders;
}

function applicationFromPackageEntry() {
  return createUiApplication({
    providers: {
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
    },
    pages: {
      table: uiRouteTable,
      shellLayouts: {
        auth: async () => ({ default: () => null }),
        chrome: async () => ({ default: () => null }),
      },
      loaders: hostRegistryWithoutGovernance(),
      errorFallback: () => null,
      rootErrorBoundary: () => null,
    },
    features: { loaders: installedModuleScreens(webModules).loaders },
    sessionQueryKey: ["test", "session"],
  });
}

describe("given a host that registers no governance loader, and the installed governance module does", () => {
  describe("when the package entry composes the application", () => {
    it("builds a router, because the installed module covers what the host left out", () => {
      expect(() => applicationFromPackageEntry()).not.toThrow();
    });

    it("routes every /governance address the table names", () => {
      const application = applicationFromPackageEntry();
      const paths = new Set<string>();

      const walk = (routes: readonly { path?: string; children?: readonly unknown[] }[]) => {
        for (const route of routes) {
          if (route.path) paths.add(route.path);
          if (route.children) walk(route.children as typeof routes);
        }
      };
      walk(application.router.routes as never);

      expect(paths.has("/governance")).toBe(true);
      expect(paths.has("/governance/inventory")).toBe(true);
      expect(paths.has("/governance/users/:id")).toBe(true);
    });
  });
});
