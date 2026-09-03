/**
 * The application a composing host actually gets from `@langwatch/ui`.
 *
 * `ui/sections/ui-application` composes whatever it is handed; the package
 * entry installs what this package serves itself first. The distinction is the
 * whole point of the governance move: `platform/app`'s shell adapter registers
 * no governance loader any more, and must not have to, because the eleven keys
 * the route table names are answered from here.
 *
 * A host registry that does not cover the table would otherwise throw at boot
 * by name — which is the failure this file proves does not happen.
 */

import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createUiApplication } from "../src/index";
import { uiRoutePageKeys, type UiPageLoaderRegistry } from "../src/behavior/ui-page-loaders";
import type { PublicEnvironment } from "../src/model/public-environment";
import { uiRouteTable } from "../src/model/ui-route-table";

const publicEnvironment = {
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
} satisfies PublicEnvironment;

function PassThrough({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/**
 * A host that serves everything EXCEPT the pages this package now serves — the
 * shape `platform/app` is in after the governance keys were deleted from its
 * registry.
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
  });
}

describe("given a host that registers no governance loader at all", () => {
  describe("when the package entry composes the application", () => {
    it("builds a router rather than throwing on the keys the host left out", () => {
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
