/**
 * @vitest-environment jsdom
 * The guided welcome: the organization is created leaving the tailor step, Langy takes over, and
 * a reload resumes from the organization's state.
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ComponentType, createElement, forwardRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));

// Plain elements in place of motion: exit animations would keep the leaving screen mounted.
vi.mock("motion/react", () => {
  const MOTION_PROPS = new Set([
    "animate",
    "initial",
    "exit",
    "variants",
    "custom",
    "layout",
    "transition",
    "whileHover",
    "whileTap",
  ]);
  const plain = (tag: string | ComponentType<Record<string, unknown>>) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const clean: Record<string, unknown> = { ref };
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_PROPS.has(key)) clean[key] = value;
      }
      return createElement(tag, clean);
    });
  const motion = new Proxy(
    {},
    { get: (_target, tag: string) => (tag === "create" ? plain : plain(tag)) },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
  };
});

vi.mock("../../elements/inputs/phone-number-input.tsx", () => ({
  PhoneNumberInput: () => <input aria-label="Phone number" />,
}));

vi.mock("../../blocks/loading-screen.tsx", () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}));

const routerState: { query: Record<string, string> } = { query: {} };
const push = vi.fn();

const { registerExperiment } = vi.hoisted(() => ({ registerExperiment: vi.fn() }));
vi.mock("../../../behavior/onboarding-experiment-registration.ts", () => ({
  registerOnboardingExperiment: registerExperiment,
}));

type MutateOptions = {
  onSuccess?: (data: { organizationId: string; projectSlug: string | null }) => void;
  onError?: (error: Error) => void;
};
const initializeOrganization =
  vi.fn<(input: Record<string, unknown>, options: MutateOptions) => void>();
const invalidateOrganizations = vi.fn();
vi.mock("../../../behavior/onboarding-api.ts", () => {
  const api = {
    onboarding: {
      initializeOrganization: {
        useMutation: () => ({ mutate: initializeOrganization, isPending: false, isSuccess: false }),
      },
    },
    joinRequests: {
      lookup: { useQuery: () => ({ data: undefined }) },
      offer: { useQuery: () => ({ data: undefined }) },
      mine: { useQuery: () => ({ data: undefined }) },
      request: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      dismissOffer: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      organization: { getAll: { invalidate: invalidateOrganizations } },
      joinRequests: { mine: { invalidate: vi.fn() }, offer: { invalidate: vi.fn() } },
    }),
  };
  return { api, onboardingApi: api };
});

vi.mock("../../../features/guided-onboarding/ui/takeover/guided-takeover.tsx", () => ({
  GuidedTakeover: (props: {
    organizationId: string;
    projectId?: string;
    projectSlug: string;
    initialPhase: string;
    initialPaths?: string[];
    returnTo: string | null;
  }) => (
    <div
      data-testid="guided-takeover"
      data-org={props.organizationId}
      data-project={props.projectId ?? ""}
      data-slug={props.projectSlug}
      data-phase={props.initialPhase}
      data-paths={(props.initialPaths ?? []).join(",")}
      data-return-to={props.returnTo ?? ""}
    />
  ),
}));

import {
  UiCapabilityContextProvider,
  type UiDeployment,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";

import {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingFailureNotice,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingScope,
} from "../../../model/onboarding-host.ts";
import { WelcomeScreen } from "../welcome-screen.tsx";

const SAAS_DEPLOYMENT: UiDeployment = {
  isDevelopment: false,
  isSaaS: true,
  appBaseUrl: "https://app.langwatch.ai",
  hasNlpService: true,
  hasLangevals: true,
  hasEmailProvider: true,
};

const flags: Record<string, boolean> = {};
const failures: OnboardingFailureNotice[] = [];
const hardRedirects: string[] = [];
let organizations: OnboardingOrganization[] = [];

class WelcomeTestHost extends OnboardingHostApi {
  scope(): OnboardingScope {
    return { organization: undefined, organizations, project: undefined, isLoading: false };
  }
  currentUser() {
    return { id: "user_1", email: "r@acme.dev", name: "Rogerio Chaves" };
  }
  sessionStatus() {
    return "authenticated" as const;
  }
  route() {
    return {
      pathname: "/onboarding/welcome",
      asPath: "/onboarding/welcome",
      params: {},
      query: {},
    };
  }
  navigate() {}
  replace() {}
  hardRedirect(to: string) {
    hardRedirects.push(to);
  }
  setQuery() {}
  featureFlag(flag: string): OnboardingFlagReading {
    return { enabled: flags[flag] ?? false, isLoading: false };
  }
  signOut() {}
  succeeded() {}
  failed(failure: OnboardingFailureNotice) {
    failures.push(failure);
  }
  async copyToClipboard() {
    return true;
  }
  revealProjectApiKey() {
    return undefined;
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

function renderWelcome() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <UiCapabilityContextProvider
        value={{
          ...createUiCapabilitiesFromHost({
            route: () => ({
              params: {},
              query: routerState.query,
              pathname: "/onboarding/welcome",
            }),
            navigate: (to: string) => push(to),
          }),
          deployment: SAAS_DEPLOYMENT,
        }}
      >
        <OnboardingHostProvider value={new WelcomeTestHost()}>
          <WelcomeScreen />
        </OnboardingHostProvider>
      </UiCapabilityContextProvider>
    </ChakraProvider>,
  );
}

const next = () => screen.getByRole("button", { name: "Next" });
const usageRadio = (name: string) => screen.getByRole("radio", { name });

/** Fills the organization screen and moves to the tailor step. */
async function reachTailorStep() {
  renderWelcome();
  await screen.findByLabelText("Organization name");
  fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "ACME" } });
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(next()).toBeEnabled());
  fireEvent.click(next());
  await screen.findByRole("radio", { name: "Company" });
}

function guidedOrganization(guidedOnboarding: Record<string, unknown>): OnboardingOrganization {
  return {
    id: "org_1",
    name: "ACME",
    primaryIntent: "LLM_OPS",
    signupData: { usage: "For my company", onboardingVariant: "guided", guidedOnboarding },
    teams: [
      { id: "team_personal", name: "Personal", isPersonal: true, projects: [] },
      {
        id: "team_1",
        name: "ACME",
        isPersonal: false,
        projects: [{ id: "proj_1", name: "ACME", slug: "acme-proj" }],
      },
    ],
  };
}

describe("WelcomeScreen in the guided variant", () => {
  beforeEach(() => {
    flags.experiment_onboarding_langy_guided = true;
    flags.release_ui_ai_governance_enabled = false;
    organizations = [];
    routerState.query = {};
    failures.length = 0;
    push.mockReset();
    initializeOrganization.mockReset();
    invalidateOrganizations.mockReset();
    registerExperiment.mockReset();
  });

  describe("when the tailor step is left", () => {
    /** @scenario "Leaving the tailor step creates the organization and the project with the variant recorded" */
    /** @scenario "the welcome flow registers the experiment property as soon as the organization is created" */
    it("creates the organization with the guided variant and hands over to Langy's hello", async () => {
      initializeOrganization.mockImplementation((_input, options) =>
        options.onSuccess?.({ organizationId: "org_new", projectSlug: "acme-proj" }),
      );
      await reachTailorStep();
      await userEvent.click(screen.getByText("Company"));
      await userEvent.click(await screen.findByRole("radio", { name: "11-50" }));
      await userEvent.click(await screen.findByRole("radio", { name: "Cloud" }));
      fireEvent.click(next());

      expect(initializeOrganization).toHaveBeenCalledTimes(1);
      expect(initializeOrganization.mock.calls[0]?.[0]).toMatchObject({
        orgName: "ACME",
        primaryIntent: "LLM_OPS",
        signUpData: expect.objectContaining({
          onboardingVariant: "guided",
          usage: "For my company",
          companySize: "11_to_50",
          terms: true,
        }),
      });
      expect(registerExperiment).toHaveBeenCalledWith("guided");
      expect(invalidateOrganizations).toHaveBeenCalledTimes(1);

      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-org", "org_new");
      expect(takeover).toHaveAttribute("data-slug", "acme-proj");
      expect(takeover).toHaveAttribute("data-phase", "hello");
      expect(screen.queryByLabelText("Organization name")).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "A failed organization creation keeps the user on the tailor step" */
    it("reports the named failure and stays on the tailor step with the answers", async () => {
      initializeOrganization.mockImplementation((_input, options) =>
        options.onError?.(new Error("plan_limit")),
      );
      await reachTailorStep();
      await userEvent.click(screen.getByText("Company"));
      await userEvent.click(await screen.findByRole("radio", { name: "1-10" }));
      await userEvent.click(await screen.findByRole("radio", { name: "Cloud" }));
      fireEvent.click(next());

      expect(failures).toEqual([
        expect.objectContaining({ fallbackTitle: "Couldn't finish setting up your organization" }),
      ]);
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
      expect(usageRadio("Company")).toBeChecked();
    });
  });

  describe("when the flag is off", () => {
    /** @scenario "The classic variant creates the organization at the end of the wizard" */
    it("leaves the tailor step without creating anything", async () => {
      flags.experiment_onboarding_langy_guided = false;
      await reachTailorStep();
      await userEvent.click(screen.getByText("Myself"));
      await waitFor(() => expect(next()).toBeEnabled());
      fireEvent.click(next());
      await screen.findByText("What brings you to LangWatch?");

      expect(initializeOrganization).not.toHaveBeenCalled();
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
    });
  });

  describe("when the welcome page is opened again", () => {
    /** @scenario "A reload after the organization exists resumes at the hello screen" */
    it("resumes at the hello screen when no paths are recorded yet", async () => {
      organizations = [guidedOrganization({ paths: [], donePaths: [] })];
      renderWelcome();
      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-phase", "hello");
      expect(takeover).toHaveAttribute("data-org", "org_1");
      expect(takeover).toHaveAttribute("data-project", "proj_1");
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "A reload after the picks resumes at the provider screen" */
    it("resumes at the provider screen once the paths are recorded", async () => {
      organizations = [guidedOrganization({ paths: ["gateway", "llmops"], donePaths: [] })];
      renderWelcome();
      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-phase", "provider");
      expect(takeover).toHaveAttribute("data-paths", "gateway,llmops");
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "An organization that already has a provider skips only the provider step" */
    it("lands on the guided path's page when the provider is recorded and the tour has not ended", async () => {
      organizations = [
        guidedOrganization({
          paths: ["llmops", "gateway"],
          currentPath: "llmops",
          donePaths: [],
          provider: "openai",
          providerModel: "gpt-5.2",
        }),
      ];
      renderWelcome();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/acme-proj/traces"));
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
    });

    /** @scenario "A reload after the guide ended leaves the welcome page" */
    it("sends the user into the product once the provider step is skipped", async () => {
      organizations = [
        guidedOrganization({
          paths: ["gateway"],
          donePaths: [],
          providerSkippedAt: "2026-09-05T10:00:00.000Z",
        }),
      ];
      renderWelcome();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/acme-proj"));
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
    });

    /** @scenario "A classic organization is never shown the takeover" */
    it("sends a classic organization's member into the product", async () => {
      organizations = [
        {
          ...guidedOrganization({ paths: [], donePaths: [] }),
          signupData: { usage: "For my company", onboardingVariant: "classic" },
        },
      ];
      renderWelcome();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/acme-proj"));
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
    });

    it("hands a pending continuation to the takeover", async () => {
      routerState.query = { return_to: "/cli/auth?user_code=ABCD" };
      organizations = [guidedOrganization({ paths: [], donePaths: [] })];
      renderWelcome();
      expect(await screen.findByTestId("guided-takeover")).toHaveAttribute(
        "data-return-to",
        "/cli/auth?user_code=ABCD",
      );
    });
  });
});

describe("WelcomeScreen in the classic variant", () => {
  beforeEach(() => {
    flags.experiment_onboarding_langy_guided = false;
    flags.release_ui_ai_governance_enabled = false;
    organizations = [];
    routerState.query = {};
    hardRedirects.length = 0;
    initializeOrganization.mockReset();
    initializeOrganization.mockImplementation((_input, options) =>
      options.onSuccess?.({ organizationId: "org_new", projectSlug: "acme-proj" }),
    );
  });

  async function finishClassicFlow() {
    await reachTailorStep();
    await userEvent.click(screen.getByText("Myself"));
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await screen.findByText("What brings you to LangWatch?");
    fireEvent.click(next());
    const finish = await screen.findByRole("button", { name: "Finish" });
    await waitFor(() => expect(finish).toBeEnabled());
    fireEvent.click(finish);
  }

  describe("when the last screen is finished", () => {
    it("creates the organization with the full sign-up answers and lands on the product step", async () => {
      await finishClassicFlow();

      expect(initializeOrganization.mock.calls[0]?.[0]).toMatchObject({
        orgName: "ACME",
        signUpData: expect.objectContaining({
          usage: "For myself",
          terms: true,
          featureUsage: "",
        }),
      });
      expect(hardRedirects).toEqual(["/onboarding/product?projectSlug=acme-proj"]);
    });

    it("finishes a pending continuation instead of the product step", async () => {
      routerState.query = { return_to: "/cli/auth?user_code=ABCD" };

      await finishClassicFlow();

      expect(hardRedirects).toEqual(["/cli/auth?user_code=ABCD"]);
    });

    it("ignores a continuation that is not a same-origin path", async () => {
      routerState.query = { return_to: "//evil.example/steal" };

      await finishClassicFlow();

      expect(hardRedirects).toEqual(["/onboarding/product?projectSlug=acme-proj"]);
    });
  });
});
