/**
 * @vitest-environment jsdom
 *
 * The plan gate on the Governance overview. The activity monitor and anomaly
 * rules routers refuse any organization that is not on an Enterprise plan,
 * and the page reads the plan up front, so for such an organization the
 * panels behind the gate name the plan, their reads are never sent, and no
 * error banner appears. A read that fails for a real reason still draws the
 * banner.
 *
 * Real page, boundaries mocked: the layout chrome, the feature flag, the
 * router, the plan, and the tRPC client.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  plan: { isEnterprise: false, isLoading: false },
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
  /** Procedure paths whose `useQuery` answers with this error. */
  failing: {} as Record<string, Error>,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    isLoading: false,
    organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
    organizations: [],
    project: undefined,
    hasPermission: () => true,
    hasOrgPermission: () => true,
    hasAnyPermission: () => true,
  }),
}));

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ ...harness.plan, activePlan: undefined }),
}));

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/components/governance/QuarantineFillAlert", () => ({
  QuarantineFillAlert: () => null,
}));

vi.mock("~/components/me/InstallCliCard", () => ({
  InstallCliCard: () => null,
}));

vi.mock("~/features/guided-onboarding/home/GuidedOnboardingOffer", () => ({
  GuidedOnboardingOffer: () => null,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (error: Error | undefined) => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: !!error,
    error: error ?? null,
    refetch: vi.fn(),
  });
  const mutationResult = () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    variables: undefined,
  });

  const node = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              const key = path.join(".");
              if (options?.enabled === false) return queryResult(undefined);
              harness.requested.push(key);
              return queryResult(harness.failing[key]);
            };
          }
          if (property === "useMutation") return mutationResult;
          if (property === "invalidate") return vi.fn();
          if (property === "useUtils") return () => node([]);
          return node([...path, property]);
        },
      },
    );

  return { api: node([]) };
});

import GovernanceOverviewPage from "../index";

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance"]}>
        <GovernanceOverviewPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

const gatedReads = () =>
  harness.requested.filter(
    (path) =>
      path.startsWith("activityMonitor.") || path === "anomalyRules.list",
  );

beforeEach(() => {
  harness.plan = { isEnterprise: false, isLoading: false };
  harness.requested = [];
  harness.failing = {};
});

afterEach(() => cleanup());

describe("governance overview plan gate", () => {
  describe("when the organization is not on an Enterprise plan", () => {
    /** @scenario "The dashboard shows no error banner for a plan without the enterprise features" */
    it("shows no error banner", () => {
      renderPage();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load the setup state"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load spend and activity"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "The dashboard shows no error banner for a plan without the enterprise features" */
    it("names the plan on the anomaly rules step and on the activity section", () => {
      renderPage();

      const step = screen.getByRole("link", {
        name: "Needs an Enterprise plan",
      });
      expect(step).toHaveAttribute("href", "/settings/subscription");
      expect(step.closest("div")?.parentElement).toHaveTextContent(
        "Define anomaly rules",
      );

      expect(screen.getByText("Spend and activity")).toBeInTheDocument();
      expect(screen.getByRole("note")).toHaveTextContent(
        "This needs the Enterprise plan",
      );
      // The rest of the checklist keeps its links.
      expect(
        screen.getByRole("link", { name: "Add an ingestion source" }),
      ).toBeInTheDocument();
    });

    /** @scenario "The dashboard shows no error banner for a plan without the enterprise features" */
    it("sends no anomaly rules or activity monitor read", () => {
      renderPage();

      expect(gatedReads()).toEqual([]);
      // The reads the plan covers still go out.
      expect(harness.requested).toContain("ingestionSources.list");
      expect(harness.requested).toContain("routingPolicy.list");
      expect(harness.requested).toContain("aiTools.adminList");
    });
  });

  describe("when the plan has not loaded yet", () => {
    /** @scenario "The dashboard keeps the checklist neutral while the plan is loading" */
    it("names no plan and sends no gated read", () => {
      harness.plan = { isEnterprise: false, isLoading: true };
      renderPage();

      expect(
        screen.queryByText("Needs an Enterprise plan"),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
      expect(gatedReads()).toEqual([]);
    });
  });

  describe("when the organization is on an Enterprise plan", () => {
    beforeEach(() => {
      harness.plan = { isEnterprise: true, isLoading: false };
    });

    /** @scenario "A setup read that fails still shows the error banner" */
    it("still shows the banner for a setup read that fails", () => {
      harness.failing["ingestionSources.list"] = new Error("boom");
      renderPage();

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't load the setup state",
      );
      expect(
        screen.queryByText("Needs an Enterprise plan"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "A setup read that fails still shows the error banner" */
    it("sends the gated reads", () => {
      renderPage();

      expect(harness.requested).toContain("anomalyRules.list");
      expect(harness.requested).toContain("activityMonitor.summary");
    });
  });
});
