/**
 * @vitest-environment jsdom
 *
 * The welcome page in the guided variant: the organization is created on
 * leaving the tailor step, Langy takes over the screen from there, and a
 * reload resumes the takeover from the organization's own state. The classic
 * wizard keeps creating the organization at its end.
 *
 * The takeover itself is a stub here; GuidedTakeover has its own test.
 *
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement, forwardRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("react-contextual-analytics", () => ({
  AnalyticsBoundary: ({ children }: { children: React.ReactNode }) => children,
  useAnalytics: () => ({ emit: vi.fn() }),
}));

// Plain elements in place of motion: exit animations would keep the leaving
// screen mounted, and the assertions want one screen at a time.
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
  const plain = (tag: string | React.ComponentType<Record<string, unknown>>) =>
    forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const clean: Record<string, unknown> = { ref };
      for (const [key, value] of Object.entries(props)) {
        if (!MOTION_PROPS.has(key)) clean[key] = value;
      }
      return createElement(tag, clean);
    });
  const motion = new Proxy(
    {},
    {
      get: (_target, tag: string) => (tag === "create" ? plain : plain(tag)),
    },
  );
  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock("~/components/inputs/PhoneNumberInput", () => ({
  PhoneNumberInput: () => <input aria-label="Phone number" />,
}));

vi.mock("~/components/LoadingScreen", () => ({
  LoadingScreen: () => <div data-testid="loading" />,
}));

vi.mock("~/utils/auth-client", () => ({ signOut: vi.fn() }));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { name: "Rogerio Chaves", email: "r@acme.dev" } },
  }),
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: true }, isLoading: false }),
}));

const flags: Record<string, boolean> = {};
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled: flags[flag] ?? false,
    isLoading: false,
  }),
}));

const orgState: { organizations: unknown[] } = { organizations: [] };
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: undefined,
    isLoading: false,
    organizations: orgState.organizations,
    project: undefined,
  }),
}));

const routerState: { query: Record<string, string> } = { query: {} };
const push = vi.fn();
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ query: routerState.query, push, route: "/welcome" }),
}));

const trackEventOnce = vi.fn();
vi.mock("~/utils/tracking", () => ({
  trackEventOnce: (...args: unknown[]) => trackEventOnce(...args),
}));

const showErrorToast = vi.fn();
vi.mock("~/features/errors", () => ({
  showErrorToast: (args: unknown) => showErrorToast(args),
}));

type MutateOptions = {
  onSuccess?: (data: {
    organizationId: string;
    projectSlug: string | null;
  }) => void;
  onError?: (error: Error) => void;
};
const initializeOrganization =
  vi.fn<(input: Record<string, unknown>, options: MutateOptions) => void>();
const invalidateOrganizations = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    onboarding: {
      initializeOrganization: {
        useMutation: () => ({
          mutate: initializeOrganization,
          isPending: false,
          isSuccess: false,
        }),
      },
    },
    useUtils: () => ({
      organization: { getAll: { invalidate: invalidateOrganizations } },
    }),
  },
}));

vi.mock("~/features/guided-onboarding/takeover/GuidedTakeover", () => ({
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

import { WelcomeScreen } from "../WelcomeScreen";

afterEach(cleanup);

function renderWelcome() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WelcomeScreen />
    </ChakraProvider>,
  );
}

const next = () => screen.getByRole("button", { name: "Next" });
const usageRadio = (name: string) => screen.getByRole("radio", { name });

/** Fills the organization screen and moves to the tailor step. */
async function reachTailorStep() {
  renderWelcome();
  await screen.findByLabelText("Organization name");
  fireEvent.change(screen.getByLabelText("Organization name"), {
    target: { value: "ACME" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(next()).toBeEnabled());
  fireEvent.click(next());
  await screen.findByRole("radio", { name: "Company" });
}

function guidedOrganization(guidedOnboarding: Record<string, unknown>) {
  return {
    id: "org_1",
    name: "ACME",
    primaryIntent: "LLM_OPS",
    signupData: {
      usage: "For my company",
      onboardingVariant: "guided",
      guidedOnboarding,
    },
    teams: [
      { isPersonal: true, projects: [] },
      { isPersonal: false, projects: [{ id: "proj_1", slug: "acme-proj" }] },
    ],
  };
}

describe("WelcomeScreen in the guided variant", () => {
  beforeEach(() => {
    flags.experiment_onboarding_langy_guided = true;
    flags.release_ui_ai_governance_enabled = false;
    orgState.organizations = [];
    routerState.query = {};
    push.mockReset();
    initializeOrganization.mockReset();
    invalidateOrganizations.mockReset();
    trackEventOnce.mockReset();
    showErrorToast.mockReset();
  });

  describe("when the tailor step opens", () => {
    /** @scenario "The tailor step starts with nothing selected and expands for a company" */
    it("starts with nothing selected and asks the company questions once Company is picked", async () => {
      await reachTailorStep();
      for (const name of ["Company", "Clients", "Myself"]) {
        expect(usageRadio(name)).toHaveAttribute("aria-checked", "false");
      }
      expect(next()).toBeDisabled();
      expect(
        screen.queryByText("What is your phone number?"),
      ).not.toBeInTheDocument();

      fireEvent.click(usageRadio("Company"));
      expect(usageRadio("Company")).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText("What is your phone number?"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("How large is your company?"),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Cloud" })).toBeInTheDocument();
      expect(next()).toBeEnabled();
    });
  });

  describe("when the tailor step is left", () => {
    /** @scenario "Leaving the tailor step creates the organization and the project with the variant recorded" */
    it("creates the organization with the guided variant and hands over to Langy's hello", async () => {
      initializeOrganization.mockImplementation((_input, options) =>
        options.onSuccess?.({
          organizationId: "org_new",
          projectSlug: "acme-proj",
        }),
      );
      await reachTailorStep();
      fireEvent.click(usageRadio("Company"));
      fireEvent.click(screen.getByRole("radio", { name: "11-50" }));
      fireEvent.click(next());

      expect(initializeOrganization).toHaveBeenCalledTimes(1);
      expect(initializeOrganization.mock.calls[0]?.[0]).toMatchObject({
        orgName: "ACME",
        primaryIntent: "LLM_OPS",
        onboardingVariant: "guided",
        signUpData: expect.objectContaining({
          usage: "For my company",
          companySize: "11_to_50",
          terms: true,
        }),
      });
      expect(trackEventOnce).toHaveBeenCalledWith(
        "organization_initialized",
        expect.objectContaining({ variant: "guided" }),
      );
      expect(invalidateOrganizations).toHaveBeenCalledTimes(1);

      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-org", "org_new");
      expect(takeover).toHaveAttribute("data-slug", "acme-proj");
      expect(takeover).toHaveAttribute("data-phase", "hello");
      expect(
        screen.queryByLabelText("Organization name"),
      ).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "A failed organization creation keeps the user on the tailor step" */
    it("shows the named error and stays on the tailor step with the answers", async () => {
      initializeOrganization.mockImplementation((_input, options) =>
        options.onError?.(new Error("plan_limit")),
      );
      await reachTailorStep();
      fireEvent.click(usageRadio("Company"));
      fireEvent.click(next());

      expect(showErrorToast).toHaveBeenCalledWith(
        expect.objectContaining({
          fallbackTitle: "Couldn't finish setting up your organization",
        }),
      );
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
      expect(usageRadio("Company")).toHaveAttribute("aria-checked", "true");
      expect(
        screen.getByText("What is your phone number?"),
      ).toBeInTheDocument();
    });
  });

  describe("when the flag is off", () => {
    /** @scenario "The classic variant creates the organization at the end of the wizard" */
    it("leaves the tailor step without creating anything", async () => {
      flags.experiment_onboarding_langy_guided = false;
      await reachTailorStep();
      fireEvent.click(usageRadio("Myself"));
      fireEvent.click(next());

      expect(initializeOrganization).not.toHaveBeenCalled();
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();
      expect(
        await screen.findByText("What brings you to LangWatch?"),
      ).toBeInTheDocument();
    });
  });

  describe("when the welcome page is opened again", () => {
    /** @scenario "A reload after the organization exists resumes at the hello screen" */
    it("resumes at the hello screen when no paths are recorded yet", async () => {
      orgState.organizations = [
        guidedOrganization({ paths: [], donePaths: [] }),
      ];
      renderWelcome();
      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-phase", "hello");
      expect(takeover).toHaveAttribute("data-org", "org_1");
      expect(takeover).toHaveAttribute("data-project", "proj_1");
      expect(
        screen.queryByLabelText("Organization name"),
      ).not.toBeInTheDocument();
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "A reload after the picks resumes at the provider screen" */
    it("resumes at the provider screen once the paths are recorded", async () => {
      orgState.organizations = [
        guidedOrganization({ paths: ["gateway", "llmops"], donePaths: [] }),
      ];
      renderWelcome();
      const takeover = await screen.findByTestId("guided-takeover");
      expect(takeover).toHaveAttribute("data-phase", "provider");
      expect(takeover).toHaveAttribute("data-paths", "gateway,llmops");
      expect(push).not.toHaveBeenCalled();
    });

    /** @scenario "A reload after the provider step leaves the welcome page" */
    it("sends the user into the product once the provider step is done", async () => {
      orgState.organizations = [
        guidedOrganization({
          paths: ["gateway"],
          donePaths: [],
          provider: "openai",
          providerModel: "gpt-5.2",
        }),
      ];
      renderWelcome();
      await waitFor(() => expect(push).toHaveBeenCalledWith("/acme-proj"));
      expect(screen.queryByTestId("guided-takeover")).not.toBeInTheDocument();

      cleanup();
      push.mockReset();
      orgState.organizations = [
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
      orgState.organizations = [
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
      orgState.organizations = [
        guidedOrganization({ paths: [], donePaths: [] }),
      ];
      renderWelcome();
      expect(await screen.findByTestId("guided-takeover")).toHaveAttribute(
        "data-return-to",
        "/cli/auth?user_code=ABCD",
      );
    });
  });
});
