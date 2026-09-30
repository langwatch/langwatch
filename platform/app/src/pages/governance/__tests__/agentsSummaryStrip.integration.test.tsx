/**
 * @vitest-environment jsdom
 *
 * Where the Agents page's summary strip sits, and when it is not there at all.
 *
 * What the strip SAYS is decided by `summarizeAgentFleet` and asserted without
 * rendering in
 * `components/governance/agents/__tests__/agentSummary.unit.test.ts`. This file
 * asserts only what a rendering test can: that the four cards are above the tab
 * bar and below the sample banner, that no filter chip is above them, and that
 * a page with nothing to summarize shows no strip rather than a strip of em
 * dashes.
 *
 * The page issues no query — there is no organization-wide agent read — so the
 * only lever here is the reader's sample choice in session storage.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENTS_EMPTY_COPY } from "~/components/governance/agents";
import { SAMPLE_CHOICE_KEY } from "~/components/governance/sample";

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

vi.mock("~/components/governance/GovernanceLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    pathname: "/governance/agents",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("~/components/code/RenderCode", () => ({
  RenderCode: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

vi.mock("~/utils/api", () => {
  const node = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "useQuery")
            return () => ({
              data: undefined,
              isLoading: false,
              isError: false,
              refetch: vi.fn(),
            });
          // The page's sync control holds a mutation. This file asserts
          // nothing about it; it exists so the page can mount.
          if (property === "useMutation")
            return () => ({
              mutate: vi.fn(),
              mutateAsync: vi.fn(),
              isPending: false,
              variables: undefined,
            });
          return node();
        },
      },
    );
  return { api: node() };
});

import AgentsPage from "../agents";

function renderAgentsAt(initialEntries: string[] = ["/governance/agents"]) {
  const router = createMemoryRouter(
    [{ path: "/governance/agents", Component: AgentsPage }],
    { initialEntries },
  );
  const { container } = render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
  return { router, container };
}

/**
 * Whether `first` is painted before `second`.
 *
 * `compareDocumentPosition` answers document order, which is what "above the
 * agents" means in a column layout and what a screenshot would otherwise have
 * to be trusted for.
 */
function comesBefore(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

beforeEach(() => {
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the agents fleet summary strip", () => {
  describe("when the sample agents are on screen", () => {
    /** @scenario "The fleet summary strip sits above the filter chips and the agents" */
    it("puts four named cards above the agents", () => {
      renderAgentsAt();

      const strip = screen.getByTestId("agents-summary-strip");
      expect(strip).toBeVisible();
      for (const eyebrow of ["Fleet", "Health", "Ownership", "Top spenders"]) {
        expect(within(strip).getByText(eyebrow)).toBeVisible();
      }

      // The tab bar used to be the landmark here. With the tabs gone the
      // landmark is the agents themselves, which is what the strip actually
      // summarizes and therefore the stricter subject.
      const list = screen.getByTestId("governance-agents-table");
      expect(comesBefore(strip, list)).toBe(true);
    });

    /** @scenario "The fleet summary strip sits above the filter chips and the agents" */
    it("sits below the banner that says nothing on the page is real", () => {
      renderAgentsAt();

      const banner = screen.getByRole("status");
      const strip = screen.getByTestId("agents-summary-strip");

      expect(banner).toHaveTextContent(/nothing here is real/i);
      expect(comesBefore(banner, strip)).toBe(true);
    });

    /** @scenario "The fleet summary strip sits above the filter chips and the agents" */
    it("carries no filter chip above it", () => {
      renderAgentsAt();

      const strip = screen.getByTestId("agents-summary-strip");
      // The chips exist on this page, so an assertion that none precedes the
      // strip is only worth something because there is something to precede
      // it: find them first, then check where they are.
      const chips = screen
        .getAllByRole("button")
        .filter((button) =>
          /All sources|All agents|Spend/.test(button.textContent ?? ""),
        );
      expect(chips.length).toBeGreaterThan(0);
      for (const chip of chips) expect(comesBefore(chip, strip)).toBe(false);
    });

    /**
     * The strip resumes the fleet, not one layout of it, so switching how the
     * agents are drawn must not move or remove it. This replaced an assertion
     * that it survived opening the Applications tab, which is the same claim
     * about the control the page had at the time.
     */
    /** @scenario "The fleet summary strip sits above the filter chips and the agents" */
    it("stays put, and above them, when the reader switches to the cards", () => {
      renderAgentsAt(["/governance/agents?view=grid"]);

      const strip = screen.getByTestId("agents-summary-strip");
      expect(strip).toBeVisible();
      const cards = screen.getAllByTestId("governance-agent-card");
      expect(comesBefore(strip, cards[0] as HTMLElement)).toBe(true);
    });
  });

  describe("when the reader has turned sample data off", () => {
    /** @scenario "With nothing to summarize the strip is absent rather than showing zeroes" */
    it("shows no strip at all, and the pane says why", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      expect(screen.queryByTestId("agents-summary-strip")).toBeNull();
      // Not a strip of em dashes above an empty pane: the pane's own sentence
      // is the page's one statement about having nothing.
      expect(screen.queryByText("Fleet")).toBeNull();
      expect(screen.getByText(AGENTS_EMPTY_COPY.headline)).toBeVisible();
    });
  });
});
