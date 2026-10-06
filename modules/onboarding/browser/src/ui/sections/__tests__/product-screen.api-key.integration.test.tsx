/**
 * @vitest-environment jsdom
 * The manual setup card mints a personal access token on the project resolved from
 * `projectSlug` only when the reader asks: no key is on the page before.
 * Spec: specs/features/onboarding/manual-setup-api-key.feature, specs/api-keys/api-keys-v2.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));

vi.mock("../../blocks/onboarding-container.tsx", () => ({
  OnboardingContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../elements/screen-lifecycle.tsx", () => ({
  ScreenLifecycle: () => null,
}));

vi.mock("../../../behavior/use-product-flow.ts", () => ({
  useProductFlow: () => ({
    currentScreenIndex: 0,
    flow: { visibleScreens: [0] },
    navigation: { nextScreen: vi.fn(), prevScreen: vi.fn() },
    canGoBack: false,
    handleSelectProduct: vi.fn(),
  }),
}));

// The hook's own suite covers scoping; this double records the project and holds the token.
// `tokens` answers the default (ingestion) mint, `readTokens` a mint that names permissions.
const minted = vi.hoisted(() => {
  const readTokens: Record<string, string> = {};
  return {
    projects: [] as (string | undefined)[],
    permissions: [] as (readonly string[] | undefined)[],
    tokens: {} as Record<string, string>,
    readTokens,
  };
});
const PROJECT_READS = vi.hoisted(() => ["project:view", "traces:view"]);
vi.mock("@langwatch/api-key-client", () => ({
  PROJECT_READ_PERMISSIONS: PROJECT_READS,
  useMintPersonalToken: ({
    projectId,
    permissions,
  }: {
    projectId: string | undefined;
    permissions?: readonly string[];
  }) => useMintDouble(projectId, permissions),
}));

function useMintDouble(projectId: string | undefined, permissions: readonly string[] | undefined) {
  const [token, setToken] = useState<string>();
  return {
    token,
    isMinting: false,
    scopeNote: "",
    mint: async () => {
      minted.projects.push(projectId);
      minted.permissions.push(permissions);
      const answers = permissions ? minted.readTokens : minted.tokens;
      const answer = projectId ? answers[projectId] : undefined;
      if (!answer) throw new Error("refused");
      setToken(answer);
      return answer;
    },
  };
}

// Read at render time, after the top-level imports below have bound them.
const shown = vi.hoisted(() => ({ screen: "manually" }));
vi.mock("../create-product-screens.tsx", () => ({
  useCreateProductScreens: () => [
    shown.screen === "manually"
      ? { id: "manually", heading: "Manual Setup", component: ApiIntegrationInfoCard }
      : { id: "via-claude-code", heading: "Coding agent", component: ViaClaudeCodeScreen },
  ],
}));

import {
  UiCapabilityContextProvider,
  type UiDeployment,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { API_KEY_PLACEHOLDER } from "@langwatch/design-system/personal-access-token-banner";

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingScope,
} from "../../../model/onboarding-host.ts";
import { ApiIntegrationInfoCard } from "../observability/api-integration-info-card.tsx";
import { ProductScreen } from "../product-screen.tsx";
import { ViaClaudeCodeScreen } from "../via-claude-code-screen.tsx";

const SAAS_DEPLOYMENT: UiDeployment = {
  isDevelopment: false,
  isSaaS: true,
  hasCloudOps: false,
  appBaseUrl: "https://app.langwatch.ai",
  hasNlpService: true,
  hasLangevals: true,
  hasEmailProvider: true,
};

const TEST_TOKEN = "lw-pat-test-fixture-not-a-real-token-0000";
const READS_TOKEN = "lw-pat-test-fixture-project-reads-1111";

const organization: OnboardingOrganization = {
  id: "org_1",
  name: "ACME",
  primaryIntent: "LLM_OPS",
  teams: [
    {
      id: "team_1",
      name: "ACME",
      isPersonal: false,
      projects: [
        { id: "proj_other", name: "Other", slug: "acme-other", createdAt: "2026-09-02T00:00:00Z" },
        { id: "proj_agent", name: "Agent", slug: "acme-agent", createdAt: "2026-09-01T00:00:00Z" },
      ],
    },
  ],
};

class ProductTestHost extends OnboardingHostApi {
  readonly copies: string[] = [];
  userId = "user_1";

  scope(): OnboardingScope {
    return {
      organization,
      organizations: [organization],
      project: undefined,
      isLoading: false,
    };
  }
  currentUser() {
    return { id: this.userId, email: "r@acme.dev", name: "Test User" };
  }
  sessionStatus() {
    return "authenticated" as const;
  }
  route() {
    return {
      pathname: "/onboarding/product",
      asPath: "/onboarding/product",
      params: {},
      query: {},
    };
  }
  navigate() {}
  replace() {}
  hardRedirect() {}
  setQuery() {}
  featureFlag(): OnboardingFlagReading {
    return { enabled: false, isLoading: false };
  }
  signOut() {}
  succeeded() {}
  failed() {}
  async copyToClipboard(input: { text: string }) {
    this.copies.push(input.text);
    return true;
  }
  prefersReducedMotion() {
    return true;
  }
  langy() {
    return { dock() {}, queueKickoff() {}, onScopeAnnounced: () => () => undefined };
  }
  sidebar() {
    return { expandGroup() {}, collapseGroup() {}, restoreAll() {} };
  }
  governance() {
    return { setSampleChoice() {} };
  }
  joinOffers() {
    return [];
  }
}

afterEach(() => {
  cleanup();
  minted.projects = [];
  minted.permissions = [];
  minted.tokens = {};
  minted.readTokens = {};
  shown.screen = "manually";
});

function renderManualSetup(host: ProductTestHost) {
  const query = { projectSlug: "acme-agent", step: "manually" };
  const tree = () => (
    <DesignSystemProvider forcedTheme="light">
      <UiCapabilityContextProvider
        value={{
          ...createUiCapabilitiesFromHost({
            route: () => ({ params: {}, query, pathname: "/onboarding/product" }),
            navigate: vi.fn(),
          }),
          deployment: SAAS_DEPLOYMENT,
        }}
      >
        <OnboardingHostProvider value={host}>
          <ProductScreen />
        </OnboardingHostProvider>
      </UiCapabilityContextProvider>
    </DesignSystemProvider>
  );
  const utils = render(tree());
  return { ...utils, rerenderManualSetup: () => utils.rerender(tree()) };
}

describe("ProductScreen manual setup", () => {
  describe("when the reader may mint a key on the project named by projectSlug", () => {
    /** @scenario Manual setup offers a personal access token for the project named in the address, shown once */
    it("mints on that project on the click and never before", async () => {
      const host = new ProductTestHost();
      minted.tokens = { proj_agent: TEST_TOKEN };
      renderManualSetup(host);

      const create = await screen.findByRole("button", { name: "Create a key" });
      expect(minted.projects).toEqual([]);
      expect(screen.getByLabelText("Your API key").textContent).toContain(
        "<YOUR_LANGWATCH_API_KEY>",
      );

      fireEvent.click(create);

      await waitFor(() =>
        expect(screen.getByLabelText("Your API key").textContent).toContain(TEST_TOKEN),
      );
      expect(minted.projects).toEqual(["proj_agent"]);

      fireEvent.click(screen.getByRole("button", { name: "Copy your api key" }));
      await waitFor(() => expect(host.copies).toEqual([TEST_TOKEN]));
    });
  });

  describe("when the mint is refused", () => {
    /** @scenario Manual setup fills in no token when the mint is refused */
    it("keeps the placeholder and copies nothing", async () => {
      const host = new ProductTestHost();
      renderManualSetup(host);

      fireEvent.click(await screen.findByRole("button", { name: "Create a key" }));

      await waitFor(() => expect(minted.projects).toEqual(["proj_agent"]));
      expect(screen.getByLabelText("Your API key").textContent).toContain(
        "<YOUR_LANGWATCH_API_KEY>",
      );
      expect(host.copies).toEqual([]);
    });
  });
});

describe("ProductScreen coding-agent setup", () => {
  describe("when the reader creates a token on each setup screen", () => {
    /** @scenario A coding-agent setup mints its MCP token with project reads only, apart from the ingestion token */
    it("mints ingestion only for the manual snippets and project reads only for the MCP config", async () => {
      const host = new ProductTestHost();
      const clipboard: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (text: string) => void clipboard.push(text) },
      });
      minted.tokens = { proj_agent: TEST_TOKEN };
      minted.readTokens = { proj_agent: READS_TOKEN };
      const { rerenderManualSetup } = renderManualSetup(host);
      fireEvent.click(await screen.findByRole("button", { name: "Create a key" }));
      await waitFor(() =>
        expect(screen.getByLabelText("Your API key").textContent).toContain(TEST_TOKEN),
      );
      expect(minted.permissions).toEqual([undefined]);

      shown.screen = "via-claude-code";
      rerenderManualSetup();
      fireEvent.click(await screen.findByRole("button", { name: "MCP" }));
      const create = await screen.findByRole("button", {
        name: "Create a key",
      });
      fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
      await waitFor(() => expect(clipboard).toHaveLength(1));
      expect(clipboard[0]).toContain(API_KEY_PLACEHOLDER);
      expect(clipboard[0]).not.toContain(TEST_TOKEN);

      fireEvent.click(create);
      await waitFor(() => expect(minted.permissions).toEqual([undefined, PROJECT_READS]));
      fireEvent.click(screen.getByRole("button", { name: "Copy config" }));
      await waitFor(() => expect(clipboard).toHaveLength(2));
      expect(clipboard[1]).toContain(READS_TOKEN);
      expect(clipboard[1]).not.toContain(TEST_TOKEN);
      expect(minted.projects).toEqual(["proj_agent", "proj_agent"]);
    });
  });
});
