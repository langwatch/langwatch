/**
 * @vitest-environment jsdom
 *
 * The Agent Testing release flag is off by default and carries one rule that
 * names an organization. The menu must state the organization it reads the
 * flag for, or the rule matches nothing and the rollout reaches no one.
 *
 * The flag hook is NOT stubbed here: the fake tRPC query runs the real rule
 * matcher over the input the hook sends, so a read that drops a scope fails
 * this test the way it failed in production.
 *
 * @see specs/features/agent-testing/page-structure.feature
 * @see specs/ops/internal-feature-flags.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as NextRouterModule from "~/utils/compat/next-router";

const ids = vi.hoisted(() => ({
  organizationId: "organization-1",
  projectId: "project-1",
}));

vi.mock("~/utils/compat/next-router", async () => {
  const actual = await vi.importActual<typeof NextRouterModule>("~/utils/compat/next-router");
  return {
    ...actual,
    useRouter: () => ({ pathname: actual.resolvePathname("/demo") }),
  };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: ids.projectId, slug: "demo" },
    organization: { id: ids.organizationId },
    hasPermission: () => true,
    isPublicRoute: false,
  }),
}));

vi.mock("~/hooks/useOpsPermission", () => ({
  useOpsPermission: () => ({ hasAccess: false }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: {} }),
}));

vi.mock("~/utils/api", async () => {
  // The real matcher, so the rule below decides the answer exactly as the
  // postgres store decides it at runtime.
  const { evaluateRules } = await vi.importActual<
    typeof import("@langwatch/feature-flag-contract")
  >("@langwatch/feature-flag-contract");

  const row = {
    enabled: false,
    rules: [{ match: { organizationId: ids.organizationId }, enabled: true }] as const,
  };

  return {
    api: {
      featureFlag: {
        isEnabled: {
          useQuery: (
            input: {
              flag: string;
              projectId: string | null;
              organizationId: string | null;
            },
            options?: { enabled?: boolean },
          ) => {
            if (options?.enabled === false) {
              return { data: undefined, isLoading: false };
            }
            if (input.flag !== "release_ui_agent_testing_v2_enabled") {
              return { data: { enabled: false }, isLoading: false };
            }
            const hit = evaluateRules([...row.rules], {
              projectId: input.projectId ?? undefined,
              organizationId: input.organizationId ?? undefined,
            });
            return { data: { enabled: hit ?? row.enabled }, isLoading: false };
          },
        },
      },
      annotation: {
        getPendingItemsCount: { useQuery: () => ({ data: 0 }) },
      },
      ops: {
        getBadgeCounts: { useQuery: () => ({ data: undefined }) },
        getDashboardSnapshot: { useQuery: () => ({ data: undefined }) },
      },
      user: {
        isAdmin: { useQuery: () => ({ data: { isAdmin: false } }) },
      },
    },
  };
});

vi.mock("~/components/sidebar/CollapsibleMenuGroup", () => ({
  CollapsibleMenuGroup: ({
    label,
    children,
  }: {
    label: string;
    children: { label: string; href: string }[];
  }) => (
    <div>
      <a href="/demo/simulations" aria-label={label}>
        {label}
      </a>
      {children.map((child) => (
        <a key={child.label} href={child.href} aria-label={child.label}>
          {child.label}
        </a>
      ))}
    </div>
  ),
}));

vi.mock("~/components/sidebar/SideMenuLink", () => ({
  SideMenuLink: ({ label, href }: { label: string; href: string }) => (
    <a href={href} aria-label={label}>
      {label}
    </a>
  ),
}));

vi.mock("~/components/sidebar/UsageIndicator", () => ({
  UsageIndicator: () => null,
}));

vi.mock("~/components/sidebar/SupportMenu", () => ({
  SupportMenu: () => null,
}));

vi.mock("~/components/sidebar/ThemeToggle", () => ({
  ThemeToggle: () => null,
}));

import { MainMenu } from "../MainMenu";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const linkNamed = (label: string) => screen.queryByRole("link", { name: label });

describe("<MainMenu /> with an organization-scoped rule on the release flag", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  describe("given the flag is off by default and one rule names the organization", () => {
    describe("when the main menu is read", () => {
      /** @scenario "A rule that names the organization lights up the main menu" */
      it("shows Agent Testing and drops the Simulations group it replaces", () => {
        render(<MainMenu />, { wrapper: Wrapper });

        expect(linkNamed("Agent Testing")).toHaveAttribute("href", "/demo/agent-testing");
        expect(linkNamed("Simulations")).toBeNull();
      });
    });
  });
});
