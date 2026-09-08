/**
 * @vitest-environment jsdom
 *
 * What the Agents tab holds: the sample cards that fill an empty page, the
 * register action that opens the connect-from-code flow rather than a form,
 * and the three chips that filter and sort the cards through the address.
 *
 * The page issues no query — there is no organization-wide agent read — so
 * everything here is driven from the address and from session storage, which
 * is where the reader's sample choice lives. `RenderCode` is mocked to a plain
 * block: the snippet under test is the string the dialog passes it, and
 * highlighting it through Shiki in jsdom buys nothing.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type React from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findNativeSelects } from "~/components/governance/filters";
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
 * Buttons of known variant and size, rendered beside the page so a header
 * action can be compared against the real class Chakra emits for that recipe.
 */
function ButtonReferences() {
  return (
    <>
      <Button size="sm" variant="ghost">
        reference ghost small
      </Button>
      <Button size="sm" variant="subtle" colorPalette="orange">
        reference subtle small
      </Button>
      <Button size="sm" variant="solid" colorPalette="orange">
        reference solid small
      </Button>
    </>
  );
}

function renderAgentsWithReferences(entry = "/governance/agents") {
  const router = createMemoryRouter(
    [
      {
        path: "/governance/agents",
        element: (
          <>
            <AgentsPage />
            <ButtonReferences />
          </>
        ),
      },
    ],
    { initialEntries: [entry] },
  );
  return render(
    <ChakraProvider value={defaultSystem}>
      <RouterProvider router={router} />
    </ChakraProvider>,
  );
}

/** Opens a filter chip by its label and picks one of its options. */
async function pickFilter(chipLabel: string, option: string) {
  const user = userEvent.setup();
  const chip = screen
    .getByText(chipLabel)
    .closest("button") as HTMLButtonElement;
  await user.click(chip);
  const item = await screen.findByRole("menuitem", { name: option });
  await user.click(item);
}

const cardNames = () =>
  screen
    .getAllByTestId("governance-agent-card")
    .map((card) => card.querySelector("p")?.textContent ?? "");

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the agents page sample cards", () => {
  describe("when a governance viewer opens a page with nothing measured on it", () => {
    /** @scenario "The empty agents page fills itself with sample agents" */
    it("fills it with sample agent cards under a banner that says so", () => {
      renderAgentsAt();

      expect(
        screen.getAllByTestId("governance-agent-card").length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole("status").textContent).toContain(
        "nothing here is real",
      );
      expect(screen.getAllByText("sample").length).toBeGreaterThan(0);
    });

    /** @scenario "The sample toggle and the register action sit in the page header" */
    it("puts the sample toggle and the register action beside the page title", () => {
      renderAgentsAt();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const register = screen.getByRole("button", { name: /Register agent/ });
      const toggle = screen.getByRole("button", { name: "Hide sample data" });

      expect(headerRow).toContainElement(register);
      expect(headerRow).toContainElement(toggle);
      expect(
        screen.getAllByRole("button", { name: /Register agent/ }),
      ).toHaveLength(1);
    });

    /**
     * Variant is proved against buttons of known variant rendered beside the
     * page, not against each other: two header actions that merely differ
     * could both be wrong. The solid reference carries the same palette as
     * the real button, because `colorPalette` is part of the class Chakra
     * generates and a reference without it would never match.
     *
     * @scenario "Primary page actions sit top-right in the page header"
     */
    it("renders Register agent solid small and the sample toggle ghost small", () => {
      // Sample off, so the toggle is in its resting state.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsWithReferences();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const solidSmall = screen.getByText("reference solid small").className;
      const ghostSmall = screen.getByText("reference ghost small").className;

      const actions = within(headerRow).getAllByRole("button");
      expect(actions).toHaveLength(2);
      expect(
        within(headerRow).getByRole("button", { name: /Register agent/ })
          .className,
      ).toBe(solidSmall);
      expect(
        within(headerRow).getByRole("button", { name: "See sample data" })
          .className,
      ).toBe(ghostSmall);
      expect(
        actions.filter((action) => action.className === solidSmall),
      ).toHaveLength(1);
    });

    /**
     * The pressed half of the same rule. The toggle picks up a subtle
     * treatment once samples are showing, so a reader can see at a glance
     * that they are looking at invented data, and it is still never solid.
     * The test above covers the rest half; neither covers both.
     *
     * @scenario "Primary page actions sit top-right in the page header"
     */
    it("keeps the pressed sample toggle subtle and never solid", () => {
      renderAgentsWithReferences();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const solidSmall = screen.getByText("reference solid small").className;
      const subtleSmall = screen.getByText("reference subtle small").className;

      const toggle = within(headerRow).getByRole("button", {
        name: "Hide sample data",
      });
      expect(toggle.className).toBe(subtleSmall);
      expect(toggle.className).not.toBe(solidSmall);
      expect(
        within(headerRow).getByRole("button", { name: /Register agent/ })
          .className,
      ).toBe(solidSmall);
    });
  });

  describe("when the reader turns sample data off", () => {
    /** @scenario "Turning sample data off leaves the honest empty pane" */
    it("removes every card and leaves the pane's own sentence", async () => {
      const user = userEvent.setup();
      renderAgentsAt();

      await user.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );

      await waitFor(() =>
        expect(screen.queryAllByTestId("governance-agent-card")).toHaveLength(
          0,
        ),
      );
      expect(
        screen.getByText(/Agents appear here as they are detected/),
      ).toBeVisible();
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});

describe("registering an agent", () => {
  describe("when the reader chooses Register agent", () => {
    /** @scenario "Register agent opens the connect-from-code flow" */
    it("explains that the agent registers itself and shows both snippets", async () => {
      const user = userEvent.setup();
      renderAgentsAt();

      await user.click(screen.getByRole("button", { name: /Register agent/ }));

      expect(
        await screen.findByText(/An agent registers itself from the process/),
      ).toBeVisible();
      expect(screen.getByText(/@langwatch.connect_agent/)).toBeVisible();
      expect(screen.getByText(/connectAgent\(/)).toBeVisible();
      // Instructions, not a form: nothing here could be persisted, so nothing
      // is collected.
      expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    });
  });

  describe("when the address asks for the register dialog", () => {
    /** @scenario "An address asking for the register dialog opens it on arrival" */
    it("opens it without a click", async () => {
      renderAgentsAt(["/governance/agents?tab=agents&add=1"]);

      expect(
        await screen.findByText(/An agent registers itself from the process/),
      ).toBeVisible();
    });

    /** @scenario "Closing the register dialog takes the request out of the address" */
    it("takes add out of the address when the reader closes it", async () => {
      const user = userEvent.setup();
      const { router } = renderAgentsAt([
        "/governance/agents?tab=agents&add=1",
      ]);
      await screen.findByText(/An agent registers itself from the process/);

      await user.click(screen.getByRole("button", { name: /close/i }));

      await waitFor(() =>
        expect(router.state.location.search).not.toContain("add"),
      );
    });
  });
});

describe("the whole agents page", () => {
  describe("when it renders with its agents and again with none", () => {
    /**
     * The subject is `document.body`, not the render container: the register
     * dialog and every chip menu portal out of the container, and those are
     * exactly the places a native select would hide. Each pass opens one of
     * them and asserts while it is on screen.
     *
     * @scenario "No governance page renders a native select"
     */
    it("contains no native select element, sample or empty", async () => {
      const user = userEvent.setup();

      renderAgentsAt();
      expect(findNativeSelects(document.body)).toHaveLength(0);

      await user.click(
        screen.getByText("Source").closest("button") as HTMLButtonElement,
      );
      expect(
        await screen.findByRole("menuitem", { name: "Databricks" }),
      ).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
      cleanup();

      renderAgentsAt();
      await user.click(screen.getByRole("button", { name: /Register agent/ }));
      expect(
        await screen.findByText(/An agent registers itself from the process/),
      ).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
      cleanup();

      // And with none: sample off, nothing connected, so the pane is down to
      // its own sentence and the chips are gone with the cards.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();
      expect(
        screen.getByText(/Agents appear here as they are detected/),
      ).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});

describe("the agents filter chips", () => {
  describe("when the page renders its sample cards", () => {
    /** @scenario "Source and ownership are filter chips beside the sort chip" */
    it("offers Source, Ownership and Sort as chips and no native select", () => {
      const { container } = renderAgentsAt();

      expect(screen.getByText("Source")).toBeVisible();
      expect(screen.getByText("Ownership")).toBeVisible();
      expect(screen.getByText("Sort")).toBeVisible();
      expect(findNativeSelects(container)).toHaveLength(0);
    });

    /** @scenario "Every filter and sort control sits in one row under the page header" */
    it("keeps every chip in one row and renders no filter anywhere else", () => {
      const { container } = renderAgentsAt();

      const chips = [...container.querySelectorAll('[aria-haspopup="menu"]')];
      expect(chips).toHaveLength(3);
      const rows = new Set(chips.map((chip) => chip.parentElement));
      expect(rows.size).toBe(1);
    });

    /** @scenario "The sample toggle sits top-right and the banner directly under the header" */
    it("puts the toggle in the header row and the banner under it, above the chips", () => {
      const { container } = renderAgentsAt();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      expect(headerRow).toContainElement(
        screen.getByRole("button", { name: "Hide sample data" }),
      );

      const banner = screen.getByRole("status");
      expect(headerRow.nextElementSibling).toBe(banner);
      const firstChip = container.querySelector('[aria-haspopup="menu"]');
      expect(
        banner.compareDocumentPosition(firstChip as Node) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    /** @scenario "A card names the agent, where it runs, who owns it and what it costs" */
    it("names the agent, its environment, its owner, its models and its figures", () => {
      renderAgentsAt();

      const card = screen
        .getByText("support-copilot")
        .closest('[data-testid="governance-agent-card"]') as HTMLElement;

      expect(card.textContent).toContain("production");
      expect(card.textContent).toContain("Customer Support");
      expect(card.textContent).toContain("gpt-5-mini");
      expect(card.textContent).toContain("Custom");
      expect(card.textContent).toContain("$4,182.40");
      expect(card.textContent).toContain("128,400");
      expect(card.textContent).toContain("ago");
    });

    /** @scenario "A figure the platform does not have reads as a dash, never a zero" */
    it("renders a dash with its reason for an agent that has never run", () => {
      renderAgentsAt();

      const card = screen
        .getByText("contract-review")
        .closest('[data-testid="governance-agent-card"]') as HTMLElement;

      expect(card.textContent).toContain("—");
      expect(card.textContent).not.toContain("$0.00");
      expect(
        card.querySelector(
          '[aria-label="The platform has not measured this yet."]',
        ),
      ).not.toBeNull();
      expect(
        card.querySelector(
          '[aria-label="This agent has registered but has never run."]',
        ),
      ).not.toBeNull();
    });
  });

  describe("when the reader picks a single source", () => {
    /** @scenario "Filtering by source leaves only that source's agents" */
    it("leaves only that source's cards", async () => {
      renderAgentsAt();

      await pickFilter("Source", "Databricks");

      await waitFor(() =>
        expect(cardNames()).toEqual([
          "genie-revenue-analyst",
          "genie-supply-planner",
        ]),
      );
    });
  });

  describe("when the reader picks Unclaimed only", () => {
    /** @scenario "Ownership filters down to the agents nobody has claimed" */
    it("leaves only the cards carrying the Unclaimed badge", async () => {
      renderAgentsAt();

      await pickFilter("Ownership", "Unclaimed only");

      await waitFor(() =>
        expect(cardNames()).toEqual([
          "genie-revenue-analyst",
          "churn-predictor",
          "it-service-triage",
          "contract-review",
        ]),
      );
      expect(screen.getAllByText("Unclaimed")).toHaveLength(4);
    });
  });

  describe("when the reader sorts by requests", () => {
    /** @scenario "Sorting reorders the cards" */
    it("orders the cards by request count instead of spend", async () => {
      renderAgentsAt();
      expect(cardNames()[2]).toBe("genie-revenue-analyst");

      await pickFilter("Sort", "Requests");

      await waitFor(() => expect(cardNames()[2]).toBe("fraud-triage"));
      // The agent that never ran sorts last on every ordering: no figure is
      // not the same as the smallest figure.
      expect(cardNames().at(-1)).toBe("contract-review");
    });
  });

  describe("when a choice has been made", () => {
    /** @scenario "A filter choice is part of the address" */
    it("writes each choice to the address and reads all three back", async () => {
      const { router } = renderAgentsAt();

      await pickFilter("Source", "Databricks");
      await pickFilter("Ownership", "Unclaimed only");
      await pickFilter("Sort", "Requests");

      await waitFor(() => {
        const search = router.state.location.search;
        expect(search).toContain("source=databricks");
        expect(search).toContain("ownership=unclaimed");
        expect(search).toContain("sort=requests");
      });

      cleanup();
      renderAgentsAt([
        "/governance/agents?source=databricks&ownership=unclaimed&sort=requests",
      ]);

      // The source badge on the surviving card carries the same word, so the
      // chip is one of two — which is the point: the chip and the cards agree.
      expect(screen.getAllByText("Databricks").length).toBe(2);
      expect(screen.getByText("Unclaimed only")).toBeVisible();
      expect(screen.getByText("Requests")).toBeVisible();
      expect(cardNames()).toEqual(["genie-revenue-analyst"]);
    });
  });
});
