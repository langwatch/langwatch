/**
 * @vitest-environment jsdom
 *
 * The governance overview's opening, driven through the real page: a real
 * permission set goes into `useOrganizationTeamProject`, the real page decides
 * whether the lead pill is offered, which chips it draws and where each one
 * goes.
 *
 * Only the boundaries are mocked - the layout chrome, the feature flag, the
 * plan, the router, the inline palette, and the tRPC client.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Per-procedure answers, keyed by dotted path. */
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  push: vi.fn(),
  placeholder: "",
}));

vi.mock("~/hooks/useOrganizationTeamProject", async () => {
  const rbac =
    await vi.importActual<typeof import("~/server/api/rbac")>(
      "~/server/api/rbac",
    );
  const holds = (permission: string) =>
    rbac.hasPermissionWithHierarchy(harness.permissions, permission);
  return {
    useOrganizationTeamProject: () => ({
      isLoading: false,
      organization: { id: "org-1", slug: "acme", name: "ACME", teams: [] },
      organizations: [],
      project: undefined,
      hasPermission: holds,
      hasOrgPermission: holds,
      hasAnyPermission: holds,
    }),
  };
});

vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: true, isLoading: false }),
}));

vi.mock("~/hooks/useActivePlan", () => ({
  useActivePlan: () => ({ isEnterprise: true, activePlan: undefined }),
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

vi.mock("~/components/home/WelcomeHeader", () => ({
  WelcomeHeader: () => <h1>Good morning</h1>,
}));

vi.mock("~/features/command-bar/CommandPalette", () => ({
  CommandPalette: ({ placeholder }: { placeholder: string }) => {
    harness.placeholder = placeholder;
    return <input placeholder={placeholder} />;
  },
}));

vi.mock("~/features/command-bar/CommandBarContext", () => ({
  useCommandBar: () => ({ registerInlinePalette: () => () => undefined }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance",
    push: harness.push,
    replace: vi.fn(),
  }),
}));

vi.mock("~/utils/api", () => {
  const queryResult = (path: string) => {
    const error = harness.errors[path] ?? null;
    return {
      data: harness.data[path],
      isLoading: false,
      isFetching: false,
      isError: error !== null,
      error,
      refetch: vi.fn(),
    };
  };
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
          if (property === "useQuery") return () => queryResult(path.join("."));
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

/** The reads the hero needs, and nothing that manages. */
const VIEWER = ["organization:view", "governance:view", "activityMonitor:view"];

/** How the tRPC client hands over a handled error the router threw. */
const enterpriseLocked = () => ({
  message: "enterprise_plan_required",
  data: {
    error: {
      code: "enterprise_plan_required",
      httpStatus: 402,
      fault: "customer",
      meta: { feature: "ANOMALY_RULES" },
    },
  },
});

function renderPage() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MemoryRouter initialEntries={["/governance"]}>
        <GovernanceOverviewPage />
      </MemoryRouter>
    </ChakraProvider>,
  );
}

const leadPill = () =>
  screen
    .queryAllByRole("button")
    .find((b) => b.getAttribute("aria-haspopup") === "menu");

beforeEach(() => {
  harness.permissions = [...VIEWER];
  harness.data = {};
  harness.errors = {};
  harness.placeholder = "";
  harness.push.mockReset();
});

afterEach(() => cleanup());

describe("governance overview hero", () => {
  describe("when the viewer can manage ingestion sources", () => {
    beforeEach(() => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
    });

    /** @scenario "The hero leads with the ingestion-source pill only for whoever can manage sources" */
    it("offers the prominent Add an ingestion source pill and no setup checklist", () => {
      renderPage();

      const pill = leadPill();
      expect(pill).toBeDefined();
      expect(pill).toHaveTextContent("Add an ingestion source");
      expect(screen.queryByText("Setup checklist")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Couldn't load the setup state"),
      ).not.toBeInTheDocument();
    });

    /** @scenario "Picking a vendor from the pill opens the inventory on that vendor" */
    it("takes a picked vendor to the inventory with that source type ready to add", async () => {
      renderPage();

      await userEvent.click(leadPill()!);
      await userEvent.click(await screen.findByText("OpenAI"));
      expect(harness.push).toHaveBeenCalledWith(
        "/governance/inventory?tab=sources&add=openai_admin",
      );

      await userEvent.click(leadPill()!);
      await userEvent.click(await screen.findByText("All sources…"));
      expect(harness.push).toHaveBeenLastCalledWith(
        "/governance/inventory?tab=sources",
      );
    });

    it("lists the three vendors in the order the pill's tiles draw them", async () => {
      renderPage();

      await userEvent.click(leadPill()!);
      const items = await screen.findAllByRole("menuitem");
      expect(items.map((item) => item.textContent)).toEqual([
        "Anthropic",
        "OpenAI",
        "Microsoft Copilot",
        "All sources…",
      ]);
    });
  });

  describe("when the viewer can only read ingestion sources", () => {
    /** @scenario "The hero leads with the ingestion-source pill only for whoever can manage sources" */
    it("offers no pill in its place", () => {
      harness.permissions = [...VIEWER, "ingestionSources:view"];
      renderPage();

      expect(leadPill()).toBeUndefined();
      expect(
        screen.queryByText("Add an ingestion source"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when the viewer can ask Langy", () => {
    beforeEach(() => {
      harness.permissions = [...VIEWER, "langy:create"];
    });

    /** @scenario "The shortcut chips lead to the rules and to the people" */
    it("links the rule and people chips and offers to ask Langy in the field", () => {
      renderPage();

      expect(
        screen.getByRole("link", { name: "Add an anomaly rule" }),
      ).toHaveAttribute("href", "/governance/inventory?tab=anomaly-rules");
      expect(screen.getByRole("link", { name: "Add people" })).toHaveAttribute(
        "href",
        "/governance/people",
      );
      expect(harness.placeholder).toBe(
        "Ask Langy, search, or jump to anything",
      );
    });
  });

  describe("when the viewer cannot ask Langy", () => {
    /** @scenario "The shortcut chips lead to the rules and to the people" */
    it("offers the same two chips and search without Langy", () => {
      renderPage();

      expect(
        screen.getByRole("link", { name: "Add an anomaly rule" }),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "Add people" })).toBeVisible();
      expect(harness.placeholder).toBe("Search, or jump to anything");
    });
  });

  describe("when the plan does not include anomaly rules", () => {
    /** @scenario "A plan that does not include anomaly rules raises no page error" */
    it("raises no page error and still renders the hero", () => {
      harness.errors["anomalyRules.list"] = enterpriseLocked();
      harness.errors["activityMonitor.recentAnomalies"] = enterpriseLocked();
      renderPage();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/Enterprise plan/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add people" })).toBeVisible();
    });

    it("still raises every other refusal", () => {
      harness.errors["activityMonitor.summary"] = {
        message: "forbidden",
        data: { error: { code: "forbidden", httpStatus: 403 } },
      };
      renderPage();

      expect(
        screen.getByText("Couldn't load spend and activity"),
      ).toBeInTheDocument();
    });
  });
});
