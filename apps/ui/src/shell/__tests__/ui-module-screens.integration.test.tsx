/** @vitest-environment jsdom */

import { webModules } from "@langwatch/installed-web-modules";
import { createUi } from "@langwatch/ui-kernel";
import { installedModuleScreens } from "@langwatch/ui-kernel/module-screens";
import { createUiRouteObjects, UiRouteOutlet } from "@langwatch/ui-kernel/route-objects";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { UiRouteDescriptor } from "../ui-route-table";

// The screen has its own suites; here it only has to report the view its
// declared route bound to it, which is the whole subject of this file.
vi.mock("../../../../../modules/annotation/browser/src/ui/sections/annotations-screen.tsx", () => ({
  AnnotationsScreen: ({ view }: { view: string }) => (
    <div data-testid="annotation-view">{view}</div>
  ),
}));

/** The page's config as the api serves it: the process owner's slice is all a module reads. */
const injectedConfig = {
  process: {
    mode: "test",
    deployment: "self-hosted",
    nlp: true,
    browserTracing: false,
    sampleRatio: 0,
  },
} as const;

/** The one anchor a project-scoped declaration mounts below. */
const anchorTable: readonly UiRouteDescriptor[] = [
  { page: "test/project-anchor", webRouteParent: "project", children: [] },
];

async function installModules() {
  const mount = document.createElement("div");
  mount.id = "root";
  document.body.append(mount);

  return createUi({ document, mount: "root" })
    .withModules(webModules)
    .withTransport({ query: () => Promise.resolve(null) })
    .withInjectedConfig(() => injectedConfig)
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
        "/:project/annotations/:slug",
        "/:project/automations",
        "/:project/automations/automations",
        "/:project/automations/alerts",
        "/:project/automations/schedules",
        "/:project/datasets",
        "/:project/datasets/:id",
        "/:project/online-evaluations",
        "/:project",
        "/:project/prompts",
      ]);
      expect(Object.keys(screens.loaders)).toEqual(
        expect.arrayContaining([
          "pages/governance/index",
          "pages/governance/inventory.enterprise",
          "pages/governance/ingestion-source-detail.enterprise",
          "pages/governance/anomaly-rules.enterprise",
          "pages/governance/people",
          "pages/governance/agents",
          "pages/governance/costs",
          "pages/governance/billed",
          "pages/governance/insights",
          "pages/governance/analytics",
          "pages/governance/signals",
          "pages/governance/teams",
          "pages/governance/teams/[id]",
          "pages/governance/users",
          "pages/governance/users/[id]",
          "pages/settings/plans",
          "pages/settings/subscription",
          "pages/settings/usage",
          "pages/settings/license",
          "pages/settings/scim",
          "pages/settings/annotation-scores",
          "pages/settings/topic-clustering",
          "pages/settings/email-suppressions",
          "pages/settings/integrations",
          "pages/settings/secrets",
          "pages/settings/roles",
          "pages/settings/role-bindings",
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
          "pages/settings/members",
          "pages/settings/groups",
          "pages/settings/teams",
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

      expect(installed.config).toEqual({ annotation: { process: { mode: "test" } } });
    });
  });
});
