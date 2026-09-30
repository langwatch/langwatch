/**
 * @vitest-environment jsdom
 * The manual setup card prints the key of the project resolved from `projectSlug`,
 * asked of the host because the scope graph carries no credentials.
 * Spec: specs/features/onboarding/manual-setup-api-key.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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

// Read at render time, after the top-level import below has bound it.
vi.mock("../create-product-screens.tsx", () => ({
  useCreateProductScreens: () => [
    { id: "manually", heading: "Manual Setup", component: ApiIntegrationInfoCard },
  ],
}));

import {
  UiCapabilityContextProvider,
  type UiDeployment,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingScope,
} from "../../../model/onboarding-host.ts";
import { ApiIntegrationInfoCard } from "../observability/api-integration-info-card.tsx";
import { ProductScreen } from "../product-screen.tsx";

const SAAS_DEPLOYMENT: UiDeployment = {
  isDevelopment: false,
  isSaaS: true,
  hasCloudOps: false,
  appBaseUrl: "https://app.langwatch.ai",
  hasNlpService: true,
  hasLangevals: true,
  hasEmailProvider: true,
};

const TEST_KEY = "sk-lw-test-fixture-not-a-real-key-000000000000";

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
  constructor(private readonly keys: Readonly<Record<string, string>>) {
    super();
  }
  scope(): OnboardingScope {
    return {
      organization,
      organizations: [organization],
      project: undefined,
      isLoading: false,
    };
  }
  currentUser() {
    return { id: "user_1", email: "r@acme.dev", name: "Test User" };
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
  async copyToClipboard() {
    return true;
  }
  revealProjectApiKey(projectId?: string) {
    return projectId ? this.keys[projectId] : undefined;
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

afterEach(cleanup);

function renderManualSetup(keys: Readonly<Record<string, string>>) {
  const query = { projectSlug: "acme-agent", step: "manually" };
  return render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider
        value={{
          ...createUiCapabilitiesFromHost({
            route: () => ({ params: {}, query, pathname: "/onboarding/product" }),
            navigate: vi.fn(),
          }),
          deployment: SAAS_DEPLOYMENT,
        }}
      >
        <OnboardingHostProvider value={new ProductTestHost(keys)}>
          <ProductScreen />
        </OnboardingHostProvider>
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

describe("ProductScreen manual setup", () => {
  describe("when the reader may manage the project named by projectSlug", () => {
    /** @scenario "Manual setup shows the key of the project named in the address" */
    it("prints that project's key once the reader shows it", async () => {
      renderManualSetup({ proj_agent: TEST_KEY, proj_other: "sk-lw-other-project-key-0000000000" });

      fireEvent.click(await screen.findByRole("button", { name: "Show key" }));

      expect(screen.getByLabelText("Your API key")).toHaveTextContent(
        `LANGWATCH_API_KEY=${TEST_KEY}`,
      );
    });
  });

  describe("when the server withholds the key from the reader", () => {
    /** @scenario "Manual setup shows no key to a reader the server withholds it from" */
    it("prints an empty key", async () => {
      renderManualSetup({});

      fireEvent.click(await screen.findByRole("button", { name: "Show key" }));

      expect(screen.getByLabelText("Your API key").textContent).toBe("LANGWATCH_API_KEY=");
    });
  });
});
