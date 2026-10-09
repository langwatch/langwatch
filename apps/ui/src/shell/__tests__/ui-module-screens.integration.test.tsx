/** @vitest-environment jsdom */

import { createUi } from "@langwatch/browser";
import { installedModuleScreens } from "@langwatch/browser/module-screens";
import { createUiRouteObjects, UiRouteOutlet } from "@langwatch/browser/route-objects";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { servedConfig } from "../../__tests__/ui-feature-config.fixtures";
import { browserModules } from "../../browser-modules.generated.ts";
import type { UiRouteDescriptor } from "../ui-route-table";

// The screen has its own suites; here it only has to report the view its
// declared route bound to it, which is the whole subject of this file.
vi.mock("../../../../../modules/annotation/browser/src/ui/sections/annotations-screen.tsx", () => ({
  AnnotationsScreen: ({ view }: { view: string }) => (
    <div data-testid="annotation-view">{view}</div>
  ),
}));

/** The one anchor a project-scoped declaration mounts below. */
const anchorTable: readonly UiRouteDescriptor[] = [
  { page: "test/project-anchor", webRouteParent: "project", children: [] },
];

async function installModules() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return createUi({ document, mount: "root" })
    .withModules(browserModules)
    .withTransport({ query: () => Promise.resolve(null) })
    .withInjectedConfig(() => servedConfig)
    .render();
}

describe("given the installed web modules", () => {
  describe("when the browser routes to a screen a module declared", () => {
    it("mounts the screen the declaration names, on the view its route bound", async () => {
      const installed = await installModules();
      const screens = installedModuleScreens(installed.modules);

      const router = createMemoryRouter(
        createUiRouteObjects({
          table: anchorTable,
          loaders: {
            ...screens.loaders,
            "test/project-anchor": () => Promise.resolve({ default: UiRouteOutlet }),
          },
          installedRoutes: screens.routes,
        }),
        { initialEntries: ["/acme/annotations/all"] },
      );
      render(<RouterProvider router={router} />);

      expect((await screen.findByTestId("annotation-view")).textContent).toBe("all");
    });

    it("serves every address the module declared and no address it did not", async () => {
      const installed = await installModules();
      const screens = installedModuleScreens(installed.modules);

      expect(screens.routes.project.map((route) => route.path)).toEqual([
        "/:project/annotations",
        "/:project/annotations/all",
        "/:project/annotations/me",
        "/:project/annotations/my-queue",
        "/:project/annotations/:slug",
        "/:project/automations",
        "/:project/automations/automations",
        "/:project/automations/alerts",
        "/:project/automations/schedules",
        "/:project/automations/activity",
        "/:project/datasets",
        "/:project/datasets/:id",
        "/:project/insights",
        "/:project/online-evaluations",
        "/:project",
        "/:project/prompts",
      ]);
      expect(Object.keys(screens.loaders)).toEqual(
        expect.arrayContaining([
          "pages/governance/index",
          "pages/governance/inventory.enterprise",
          "pages/governance/ingestion-source-detail.enterprise",
          "pages/governance/people",
          "pages/governance/agents",
          "pages/governance/costs",
          "pages/governance/billed",
          "pages/governance/insights",
          "pages/governance/analytics",
          "pages/governance/signals",
          "pages/governance/teams",
          "pages/governance/teams/[id]",
          "pages/governance/users/[id]",
          "pages/settings/plans",
          "pages/settings/subscription",
          "pages/settings/usage",
          "pages/settings/license",
          "pages/settings/annotation-scores",
          "pages/settings/topic-clustering",
          "pages/settings/email-suppressions",
          "pages/settings/integrations",
          "pages/settings/secrets",
          "pages/settings/roles",
          "pages/settings/data-privacy",
          "pages/settings/data-retention",
          "pages/settings",
          "pages/authorize",
          "pages/mcp/authorize",
          "pages/cli/auth",
          "pages/settings/api-keys",
          "pages/settings/model-providers",
          "pages/settings/model-costs",
          "pages/settings/audit-log",
          "pages/settings/directory",
          "pages/settings/teams/[team]",
          "pages/me/index",
          "pages/me/configure",
          "pages/me/pull-requests",
          "pages/me/sessions",
          "pages/me/budget/request",
          "pages/settings/profile",
          "pages/settings/security",
          "pages/onboarding",
          "pages/onboarding/welcome",
          "pages/onboarding/product/index",
          "pages/onboarding/[team]/project",
          "pages/auth/signin",
          "pages/auth/signup",
          "pages/auth/forgot-password",
          "pages/auth/reset-password",
          "pages/auth/verify-email",
          "pages/auth/error",
          "pages/auth/join",
          "pages/invite/accept",
        ]),
      );
    });
  });

  describe("when the shell injects its public configuration", () => {
    it("hands each module the owner slices its declaration reads", async () => {
      const installed = await installModules();

      expect(installed.config).toEqual({
        auth: {
          authProvider: "auth0",
          passkeysEnabled: true,
          emailPasswordEnabled: true,
          signUpMode: "invite_only",
        },
        authz: {},
        billing: {},
        evaluator: { hasLangevals: true },
        gateway: { gatewayBaseUrl: "https://gateway.langwatch.test" },
        notification: { hasEmailProvider: true },
        ops: { cloudOps: false, browserTracing: true, sampleRatio: 0.1 },
      });
    });
  });
});
