/**
 * @vitest-environment jsdom
 *
 * The governance overview, driven through the real page: a real permission
 * set goes into `useOrganizationTeamProject`, and the real page decides which
 * ways in it draws, where each one goes, and what it reads.
 *
 * Only the boundaries are mocked - the layout chrome, the feature flag, the
 * plan, the router, the inline palette, and the tRPC client. The tRPC double
 * records every read the page issues, which is what lets the last test say
 * the page reads nothing rather than only that it shows no error.
 *
 * Spec: specs/ai-governance/dashboard/governance-overview-hero.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  /** The grants the viewer under test holds. */
  permissions: [] as string[],
  /** Whether the billed-cost flag, which offers the Insights screen, is on. */
  flagEnabled: true,
  /** Per-procedure answers, keyed by dotted path. */
  data: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  /** Every procedure path whose `useQuery` was NOT disabled. */
  requested: [] as string[],
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

// Answered per flag, not once for all of them: the page itself rides the
// governance flag, so a blanket `false` would close the whole screen and every
// assertion about what it does not draw would pass for the wrong reason.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: (flag: string) => ({
    enabled:
      flag === "release_ui_governance_billed_cost_enabled"
        ? harness.flagEnabled
        : true,
    isLoading: false,
  }),
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
          if (property === "useQuery") {
            return (_input: unknown, options?: { enabled?: boolean }) => {
              if (options?.enabled !== false)
                harness.requested.push(path.join("."));
              return queryResult(path.join("."));
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

// The lit ground behind the hero runs a WebGL shader, which jsdom has no
// canvas for. The ground's own box — the thing the page is responsible for —
// is this component's wrapper, not the shader inside it.
vi.mock("@paper-design/shaders-react", () => ({
  MeshGradient: () => <div data-testid="mesh-gradient" />,
}));

import { findNativeSelects } from "~/components/governance/filters";
import {
  readSampleChoice,
  writeSampleChoice,
} from "~/components/governance/sample";

import GovernanceOverviewPage from "../index";

/** The reads the overview's viewer holds, and nothing that manages. */
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

/** One of the invented insights, used to find its own row. */
const A_SAMPLE_INSIGHT =
  "Three registered agents have run without a named owner since May.";

/** The hero's ways in, in the order they are drawn. */
const wayInLabels = () =>
  screen
    .getAllByRole("link")
    .map((link) => link.textContent)
    .filter((label): label is string =>
      ["Add people", "Add agent", "Add anomaly rule"].includes(label ?? ""),
    );

/** The pill, found by what it does rather than by how it is drawn. */
const sourcePill = () =>
  screen
    .queryAllByRole("button")
    .find((button) => button.getAttribute("aria-haspopup") === "menu");

/** Opens the vendor menu and waits for its items. Real Chakra menu. */
async function openSourceMenu() {
  const user = userEvent.setup();
  const pill = sourcePill();
  // A helper throws where a test asserts. An assertion out here is counted
  // against whichever test happens to be running, and the `as HTMLElement` it
  // needed afterwards hid the missing-pill case from the type checker — which
  // is the case that actually happens, and for a reason worth naming.
  if (!pill) {
    throw new Error(
      "No vendor pill on the page: the menu is only drawn with the ingestionSources:manage grant.",
    );
  }
  await user.click(pill);
  await waitFor(() => expect(screen.getByText("Anthropic")).toBeVisible());
  return user;
}

beforeEach(() => {
  // The sample choice is the section's, kept in session storage, so it would
  // otherwise carry from one test into the next.
  window.sessionStorage.clear();
  harness.permissions = [...VIEWER];
  harness.flagEnabled = true;
  harness.data = {};
  harness.errors = {};
  harness.requested = [];
  harness.placeholder = "";
  harness.push.mockReset();
});

afterEach(() => cleanup());

describe("governance overview", () => {
  describe("when the overview renders", () => {
    /** @scenario "The hero offers three ways in, in the order a surface is set up" */
    it("offers add people, add agent and add anomaly rule, in that order", () => {
      renderPage();

      expect(wayInLabels()).toEqual([
        "Add people",
        "Add agent",
        "Add anomaly rule",
      ]);
      expect(screen.getByRole("link", { name: "Add people" })).toHaveAttribute(
        "href",
        "/governance/people?tab=people",
      );
      expect(screen.getByRole("link", { name: "Add agent" })).toHaveAttribute(
        "href",
        "/governance/agents?tab=agents&add=1",
      );
      expect(
        screen.getByRole("link", { name: "Add anomaly rule" }),
      ).toHaveAttribute("href", "/governance/inventory?tab=anomaly-rules");
    });
  });

  describe("when the viewer can manage ingestion sources", () => {
    /** @scenario "The hero leads with adding a source" */
    it("leads with an Add Source control that opens rather than fires", () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();

      const pill = sourcePill();
      expect(pill).toBeDefined();
      expect(pill).toHaveTextContent("Add Source");
      // It opens a menu; nothing is navigated by touching the pill itself.
      expect(harness.push).not.toHaveBeenCalled();
    });

    /** @scenario "The source menu names the three vendors an admin arrives with" */
    it("offers Anthropic, OpenAI and Microsoft Copilot, and nothing else", async () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();
      const user = await openSourceMenu();

      expect(
        screen.getAllByRole("menuitem").map((item) => item.textContent),
      ).toEqual(["Anthropic", "OpenAI", "Microsoft Copilot"]);

      await user.click(screen.getByRole("menuitem", { name: "OpenAI" }));
      expect(harness.push).toHaveBeenCalledWith(
        "/governance/inventory?tab=sources&add=openai_admin",
      );
    });

    /** @scenario "The source menu names the three vendors an admin arrives with" */
    it("opens the sources tab on the vendor that was picked", async () => {
      harness.permissions = [...VIEWER, "ingestionSources:manage"];
      renderPage();
      const user = await openSourceMenu();

      await user.click(screen.getByRole("menuitem", { name: "Anthropic" }));
      expect(harness.push).toHaveBeenCalledWith(
        "/governance/inventory?tab=sources&add=anthropic_admin",
      );
    });
  });

  describe("when the viewer cannot manage ingestion sources", () => {
    /** @scenario "Adding a source is offered only to whoever may add one" */
    it("offers no Add Source control and the same three ways in", () => {
      renderPage();

      expect(sourcePill()).toBeUndefined();
      expect(screen.queryByText("Add Source")).not.toBeInTheDocument();
      expect(wayInLabels()).toEqual([
        "Add people",
        "Add agent",
        "Add anomaly rule",
      ]);
    });
  });

  describe("when the viewer can ask Langy", () => {
    /** @scenario "The field offers Langy to whoever may ask" */
    it("offers to ask Langy in the field", () => {
      harness.permissions = [...VIEWER, "langy:create"];
      renderPage();

      expect(harness.placeholder).toBe(
        "Ask Langy, search, or jump to anything",
      );
      expect(wayInLabels()).toHaveLength(3);
    });
  });

  describe("when the viewer cannot ask Langy", () => {
    /** @scenario "The field offers Langy to whoever may ask" */
    it("offers search without Langy and the same three ways in", () => {
      renderPage();

      expect(harness.placeholder).toBe("Search, or jump to anything");
      expect(wayInLabels()).toEqual([
        "Add people",
        "Add agent",
        "Add anomaly rule",
      ]);
    });
  });

  describe("when the sections under the hero have nothing in them", () => {
    /** @scenario "Insights and recent activity wait under the hero" */
    it("names both sections and says what will appear in each", () => {
      // The overview measures nothing, so its lists open filled with samples.
      // Their empty lines are what the reader meets after turning those off.
      writeSampleChoice(false);
      renderPage();

      expect(screen.getByText("Insights")).toBeVisible();
      expect(
        screen.getByText(
          "Nothing to report yet. Insights appear here once sources are pulling.",
        ),
      ).toBeVisible();
      expect(screen.getByText("Recent activity")).toBeVisible();
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      expect(screen.queryAllByText("sample")).toHaveLength(0);
    });

    /** @scenario "The two lists open filled with samples" */
    it("opens both lists filled in, each badged as sample", () => {
      renderPage();

      expect(screen.queryAllByText("sample")).toHaveLength(2);
      expect(screen.getByText(A_SAMPLE_INSIGHT)).toBeVisible();
      expect(
        screen.queryByText(
          "Nothing to report yet. Insights appear here once sources are pulling.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Your recent screens will show up here."),
      ).not.toBeInTheDocument();
    });

    /** @scenario "An insight row reads as a severity, a headline and a date" */
    it("gives each insight a severity, a one-line headline and a date", () => {
      renderPage();

      // All three severities are offered, each as its own badge.
      for (const severity of ["Warning", "Worth a look", "Good news"]) {
        expect(screen.getByText(severity)).toBeVisible();
      }

      const headline = screen.getByText(A_SAMPLE_INSIGHT);
      const row = headline.parentElement as HTMLElement;
      // Severity, headline, date — in that order, on one line.
      expect(row.textContent).toBe(`Warning${A_SAMPLE_INSIGHT}Yesterday`);
      expect(getComputedStyle(headline).whiteSpace).toBe("nowrap");
      expect(getComputedStyle(headline).textOverflow).toBe("ellipsis");
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("makes each recent row a link carrying its name and its kind", () => {
      renderPage();

      const row = screen.getByRole("link", { name: /Engineering/ });
      expect(row).toHaveAttribute("href", "/governance/people");
      expect(row).toHaveTextContent("Engineering");
      expect(row).toHaveTextContent("Directory");
      expect(
        screen.getByRole("link", { name: /Release notes bot/ }),
      ).toHaveAttribute("href", "/governance/agents");
    });

    /** @scenario "A recent-activity row reads as a mark, a name and a kind" */
    it("draws no row leading to a screen this organization is not offered", () => {
      // Costs and Insights ride the billed-cost flag; without it a sample row
      // pointing at either would lead to a page the guard refuses.
      harness.flagEnabled = false;
      renderPage();

      expect(
        screen.queryByRole("link", { name: /Spend by department/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: /Monthly review/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Engineering/ }),
      ).toBeInTheDocument();
    });

    /** @scenario "The overview carries the section's sample toggle" */
    it("carries the section's sample toggle, and it empties both lists", async () => {
      const user = userEvent.setup();
      renderPage();

      await user.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );

      expect(screen.queryAllByText("sample")).toHaveLength(0);
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      // The press is the section's answer, not this page's: it is the same
      // one every other governance screen reads back.
      expect(readSampleChoice()).toBe(false);
    });
  });

  describe("the ground the hero stands on", () => {
    /** @scenario "The hero stands on the same lit ground as the project home" */
    it("is decoration: hidden from assistive technology and untouchable", () => {
      const { container } = renderPage();

      const decorations = container.querySelectorAll("[aria-hidden='true']");
      const ground = [...decorations].filter(
        (node) => getComputedStyle(node).pointerEvents === "none",
      );
      expect(ground.length).toBeGreaterThan(0);
      // The field and the pill above it are still the things you can reach.
      expect(screen.getByText("Good morning")).toBeVisible();
    });
  });

  describe("when the Insights screen is offered to the organization", () => {
    /** @scenario "Setting up insights is offered only where the screen exists" */
    it("offers Set up insights, and offers nothing in its place when it is not", () => {
      renderPage();
      expect(
        screen.getByRole("link", { name: "Set up insights" }),
      ).toHaveAttribute("href", "/governance/insights");

      cleanup();
      harness.flagEnabled = false;
      renderPage();
      expect(screen.queryByText("Set up insights")).not.toBeInTheDocument();
    });
  });

  describe("when every activity-monitor read would be refused", () => {
    /** @scenario "The overview renders no error alert and issues no spend read" */
    it("shows no error and issues no activity-monitor read at all", () => {
      harness.errors["activityMonitor.summary"] = enterpriseLocked();
      harness.errors["activityMonitor.recentAnomalies"] = enterpriseLocked();
      renderPage();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByText(/Enterprise plan/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
      // Not merely unrendered: the reads that produced those refusals are
      // never issued, so nothing is left to fail.
      expect(
        harness.requested.filter(
          (path) =>
            path.startsWith("activityMonitor.") ||
            path.startsWith("ingestionSources.") ||
            path.startsWith("anomalyRules.") ||
            path.startsWith("sessionPolicy."),
        ),
      ).toEqual([]);
      expect(screen.getByText("Good morning")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add people" })).toBeVisible();
    });
  });

  describe("when the section's control rules are applied to it", () => {
    /** @scenario "No governance page renders a native select" */
    it("contains no native select element, sample or real", async () => {
      // On `document.body` rather than the render's own container: the vendor
      // menu portals out of it, and the rule is about the whole page.

      // The grant that draws the vendor pill, so the menu below is reachable.
      harness.permissions = [...VIEWER, "ingestionSources:manage"];

      // As it opens, samples on.
      renderPage();
      expect(findNativeSelects(document.body)).toHaveLength(0);

      // And with the menu down, which is the one place on this page a choice
      // is offered at all.
      await openSourceMenu();
      expect(findNativeSelects(document.body)).toHaveLength(0);
      cleanup();

      // And again with the samples off, which is this page's real state: it
      // reads nothing, so empty is the only data it ever has.
      writeSampleChoice(false);
      renderPage();
      expect(
        screen.getByText("Your recent screens will show up here."),
      ).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});
