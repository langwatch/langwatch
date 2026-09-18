/**
 * The application a composing host actually gets from `@langwatch/ui`.
 */

import { webModules } from "@langwatch/installed-modules/web";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { uiRoutePageKeys, type UiPageLoaderRegistry } from "../../behavior/ui-page-loaders";
import type { PublicEnvironment } from "../../model/public-environment";
import { createUiApplication } from "../ui-application";
import { installedModuleScreens } from "../ui-module-screens";
import { uiRouteTable } from "../ui-route-table";

const publicEnvironment = {
  BASE_HOST: "http://localhost",
  DEMO_PROJECT_SLUG: void 0,
  NODE_ENV: "test",
  NEXTAUTH_PROVIDER: void 0,
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
} satisfies PublicEnvironment;

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
      usePublicEnvironment: () => ({ data: publicEnvironment }),
      useNavigationTracking: () => void 0,
      isDevelopment: false,
    },
    pages: {
      loaders: hostRegistryWithoutGovernance(),
      errorFallback: () => null,
      rootErrorBoundary: () => null,
    },
    features: { loaders: installedModuleScreens(webModules).loaders },
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
