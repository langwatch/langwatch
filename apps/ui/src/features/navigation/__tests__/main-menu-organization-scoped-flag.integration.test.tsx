/**
 * @vitest-environment jsdom
 *
 * The Agent Testing release flag is off by default and carries one rule that
 * names an organization. The flag read the shell makes must state the
 * organization it reads for, or the rule matches nothing and the rollout
 * reaches no one.
 *
 * The matcher is NOT stubbed: the fake transport runs the real rule matcher
 * over the input the read sends, so a read that drops a scope fails this test
 * the way it failed in production.
 *
 * MOVED from `platform/app/src/components/__tests__/MainMenu.orgScopedFlag.integration.test.tsx`.
 *
 * @see specs/features/agent-testing/page-structure.feature
 * @see specs/ops/internal-feature-flags.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { evaluateRules, type FeatureFlagRules } from "@langwatch/feature-flag-contract";
import { MainMenuSections } from "@langwatch/navigation-web/chrome";
import { WithStubNavigationHost } from "@langwatch/navigation-web/testing";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The menu's own reads go through a per-package tRPC client whose provider the
// shell mounts; only the flag read is under test, so they answer nothing.
vi.mock("@langwatch/platform-api-client", async () => {
  const actual =
    await vi.importActual<typeof import("@langwatch/platform-api-client")>(
      "@langwatch/platform-api-client",
    );
  return {
    ...actual,
    createFeatureApi: () =>
      new Proxy(
        {},
        {
          get: () =>
            new Proxy({}, { get: () => ({ useQuery: () => ({ data: void 0 }) }) }),
        },
      ),
  };
});
import {
  UI_FEATURE_FLAG_PROCEDURE,
  useUiFeatureFlags,
} from "../../../behavior/ui-session-queries";
import type { UiFeatureApiTransport } from "../../../behavior/ui-feature-transport";
import { readNavigationFeatureFlag } from "../behavior/navigation-feature-flag";

const AGENT_TESTING_FLAG = "release_ui_agent_testing_v2_enabled";
const ORGANIZATION_ID = "organization-1";

/** Off by default, with one rule that names the organization reading the menu. */
const RULES: FeatureFlagRules = [
  { match: { organizationId: ORGANIZATION_ID }, enabled: true },
];

/** The real matcher, over whatever scope the read actually stated. */
const transport = {
  query: async (procedure: string, input: unknown) => {
    if (procedure !== UI_FEATURE_FLAG_PROCEDURE) return { enabled: false };
    const asked = input as { flag: string; projectId: string | null; organizationId: string | null };
    if (asked.flag !== AGENT_TESTING_FLAG) return { enabled: false };
    const hit = evaluateRules(RULES, {
      ...(asked.projectId ? { projectId: asked.projectId } : {}),
      ...(asked.organizationId ? { organizationId: asked.organizationId } : {}),
    });
    return { enabled: hit ?? false };
  },
} as unknown as UiFeatureApiTransport;

function MenuUnderRealFlagRead() {
  const flags = useUiFeatureFlags({
    transport,
    flags: [AGENT_TESTING_FLAG],
    projectId: null,
    organizationId: ORGANIZATION_ID,
    enabled: true,
  });

  return (
    <WithStubNavigationHost
      readings={{
        project: { id: "project-1", slug: "demo", name: "Demo" },
        pathname: "/[project]",
        permissions: ["scenarios:view"],
        flags: {
          [AGENT_TESTING_FLAG]: readNavigationFeatureFlag({
            answer: flags.get(AGENT_TESTING_FLAG),
          }),
        },
      }}
    >
      <MainMenuSections showExpanded />
    </WithStubNavigationHost>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("the main menu under an organization-scoped rule on the release flag", () => {
  describe("given the flag is off by default and one rule names the organization", () => {
    describe("when the main menu is read", () => {
      /** @scenario "A rule that names the organization lights up the main menu" */
      it("shows Agent Testing and drops the Simulations group it replaces", async () => {
        const client = new QueryClient({
          defaultOptions: { queries: { retry: false } },
        });

        render(
          <ChakraProvider value={defaultSystem}>
            <QueryClientProvider client={client}>
              <MenuUnderRealFlagRead />
            </QueryClientProvider>
          </ChakraProvider>,
        );

        await waitFor(() => {
          expect(
            screen.queryByRole("link", { name: "Agent Testing" })?.getAttribute("href"),
          ).toBe("/demo/agent-testing");
        });
        expect(screen.queryByRole("button", { name: /Simulations$/ })).toBeNull();
      });
    });
  });
});
