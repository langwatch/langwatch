/**
 * @vitest-environment jsdom
 *
 * What the Agents page holds: the sample agents that fill an empty page, the
 * two layouts they can be drawn in and the switch between them, the register
 * action that opens the connect-from-code flow rather than a form, and the
 * three chips that filter and sort through the address.
 *
 * THE LIST IS THE DEFAULT, so `renderAgentsAt` lands on it and the tests about
 * the CARD ask for the grid by address (`renderAgentsInGrid`). Naming the
 * layout at each render is deliberate: a test that asserted on cards without
 * saying which layout it wanted would start passing or failing for a reason
 * it never stated.
 *
 * The page issues no query — there is no organization-wide agent read — so
 * everything here is driven from the address and from session storage, which
 * is where the reader's sample choice lives. `RenderCode` is mocked to a plain
 * block: the snippet under test is the string the dialog passes it, and
 * highlighting it through Shiki in jsdom buys nothing.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */
import { Badge, Button, ChakraProvider, defaultSystem } from "@chakra-ui/react";
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

import {
  AGENT_TABLE_COLUMNS,
  AGENTS_EMPTY_COPY,
  NO_MATCHING_AGENTS_COPY,
} from "~/components/governance/agents";
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
 * The page on its optional layout, asked for the way a reader asks: through
 * the address. The cards are one press from the default, and `?view=grid` is
 * what that press writes.
 */
function renderAgentsInGrid(entry = "/governance/agents?view=grid") {
  return renderAgentsAt([entry]);
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
      <Button size="sm" variant="outline">
        reference outline small
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

/**
 * Opens a filter chip by its label and picks one of its options.
 *
 * The chip is found among the page's buttons rather than by its text alone.
 * "Ownership" names two things on this page — the chip that narrows the agents,
 * and the summary card above them that counts owned against unclaimed — and a
 * bare text query cannot tell a control from a heading. Only one of the two is
 * pressable, which is the distinction the reader makes too. "Source" is now a
 * third: the list heads a column with it.
 */
async function pickFilter(chipLabel: string, option: string) {
  const user = userEvent.setup();
  const chip = screen
    .getAllByRole("button")
    .find((button) => button.textContent?.startsWith(chipLabel));
  if (!chip) throw new Error(`No filter chip labelled ${chipLabel}`);
  await user.click(chip);
  const item = await screen.findByRole("menuitem", { name: option });
  await user.click(item);
}

/**
 * One agent card, by the name printed on it.
 *
 * Scoped to the cards, because the summary strip above them names the biggest
 * spenders too and a page-wide text query would find whichever came first.
 */
function cardNamed(name: string): HTMLElement {
  const card = screen
    .getAllByTestId("governance-agent-card")
    .find((candidate) => candidate.textContent?.includes(name));
  if (!card) throw new Error(`No agent card named ${name}`);
  return card;
}

/**
 * One agent row of the list, by the name printed on it. The name is on the
 * row as a data attribute as well as in its first cell, because the row also
 * carries model names and an owner and a text search would find whichever
 * came first.
 */
function rowNamed(name: string): HTMLElement {
  const row = screen
    .getAllByTestId("governance-agent-row")
    .find((candidate) => candidate.dataset.agent === name);
  if (!row) throw new Error(`No agent row named ${name}`);
  return row;
}

/** The listed agents, in the order the list draws them. */
const rowNames = () =>
  screen
    .getAllByTestId("governance-agent-row")
    .map((row) => row.dataset.agent ?? "");

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
});
afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("the agents page sample rows", () => {
  describe("when a governance viewer opens a page with nothing measured on it", () => {
    /** @scenario "The empty agents page shows samples when requested" */
    it("fills it with sample agents under a banner that says so", () => {
      renderAgentsAt();

      expect(
        screen.getAllByTestId("governance-agent-row").length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole("status").textContent).toContain(
        "nothing here is real",
      );
      // On the row, not on the panel: the row is what a reader quotes, so the
      // claim that it is invented has to travel with it.
      expect(screen.getAllByText("sample").length).toBe(rowNames().length);
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
     * The annotation below is on its own single line on purpose: the parity
     * checker only accepts `@scenario` when the annotation line also closes
     * the comment, so the same tag written as the last line of this block
     * binds nothing and reports nothing.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    it("renders Register agent as the outline house button and the toggle ghost", () => {
      // Sample off, so the toggle is in its resting state.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsWithReferences();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const solidSmall = screen.getByText("reference solid small").className;
      const ghostSmall = screen.getByText("reference ghost small").className;
      const outlineSmall = screen.getByText(
        "reference outline small",
      ).className;

      const actions = within(headerRow).getAllByRole("button");
      expect(actions).toHaveLength(2);
      expect(
        within(headerRow).getByRole("button", { name: /Register agent/ })
          .className,
      ).toBe(outlineSmall);
      expect(
        within(headerRow).getByRole("button", { name: "See sample data" })
          .className,
      ).toBe(ghostSmall);
      // Being outlined is what marks the create action out now that nothing in
      // the row is filled, so "only one" moved from solid to outline with it.
      expect(
        actions.filter((action) => action.className === outlineSmall),
      ).toHaveLength(1);
      // And nothing in the row is solid, in the brand orange or otherwise.
      expect(
        actions.filter((action) => action.className === solidSmall),
      ).toHaveLength(0);
    });

    /**
     * The pressed half of the same rule. The toggle picks up a subtle
     * treatment once samples are showing, so a reader can see at a glance
     * that they are looking at invented data, and it is still never solid.
     * The test above covers the rest half; neither covers both.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    it("keeps the pressed sample toggle subtle and never solid", () => {
      renderAgentsWithReferences();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const solidSmall = screen.getByText("reference solid small").className;
      const subtleSmall = screen.getByText("reference subtle small").className;
      const outlineSmall = screen.getByText(
        "reference outline small",
      ).className;

      const toggle = within(headerRow).getByRole("button", {
        name: "Hide sample data",
      });
      expect(toggle.className).toBe(subtleSmall);
      expect(toggle.className).not.toBe(solidSmall);
      // Still distinguishable from the create action, which is the clause the
      // pressed state exists to protect: subtle and outline are not the same
      // treatment, so a reader can still tell which one creates something.
      expect(toggle.className).not.toBe(outlineSmall);
      expect(
        within(headerRow).getByRole("button", { name: /Register agent/ })
          .className,
      ).toBe(outlineSmall);
    });
  });

  describe("when the filter row is placed", () => {
    /**
     * The chips narrow the agents, so they sit above them rather than among
     * them. The tab panel used to be what "the content" meant here; with the
     * tabs gone the content is the list itself, which is a stricter subject
     * anyway — a chip rendered inside the table would now be caught, and a
     * chip inside the old panel but outside the cards would not have been.
     */
    /** @scenario "The filter row sits outside the content it narrows" */
    it("keeps every chip out of the agents themselves, and offers none when there are no agents", async () => {
      renderAgentsAt();

      const chips = await screen.findAllByRole("button", {
        expanded: false,
        name: /Source|Ownership|Sort/,
      });
      expect(chips).toHaveLength(3);
      const list = screen.getByTestId("governance-agents-table");
      for (const chip of chips) {
        expect(list.contains(chip)).toBe(false);
      }

      // With nothing registered there is nothing to narrow, so the row is
      // gone rather than offering chips over an empty state.
      cleanup();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(
        document.body.querySelectorAll('[aria-haspopup="menu"]'),
      ).toHaveLength(0);
    });
  });

  describe("when the reader turns sample data off", () => {
    /** @scenario "Turning sample data off leaves the honest empty pane" */
    it("removes every agent and leaves the page's own empty state", async () => {
      const user = userEvent.setup();
      renderAgentsAt();

      await user.click(
        screen.getByRole("button", { name: "Hide sample data" }),
      );

      await waitFor(() =>
        expect(screen.queryAllByTestId("governance-agent-row")).toHaveLength(0),
      );
      expect(screen.queryByTestId("governance-agents-table")).toBeNull();
      const empty = screen.getByTestId("agents-empty");
      expect(empty).toBeVisible();
      expect(within(empty).getByText(AGENTS_EMPTY_COPY.headline)).toBeVisible();
      // The way out, which is the whole reason this replaced a dashed box.
      expect(
        within(empty).getByRole("button", {
          name: AGENTS_EMPTY_COPY.actionLabel,
        }),
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
      renderAgentsAt(["/governance/agents?add=1"]);

      expect(
        await screen.findByText(/An agent registers itself from the process/),
      ).toBeVisible();
    });

    /** @scenario "Closing the register dialog takes the request out of the address" */
    it("takes add out of the address when the reader closes it", async () => {
      const user = userEvent.setup();
      const { router } = renderAgentsAt(["/governance/agents?add=1"]);
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
     */
    /** @scenario "No governance page renders a native select" */
    it("contains no native select element, sample or empty", async () => {
      const user = userEvent.setup();

      renderAgentsAt();
      expect(findNativeSelects(document.body)).toHaveLength(0);

      // The chip among the buttons, not the word anywhere on the page: the
      // list now heads a column "Source" too, and a bare text query would
      // find whichever came first.
      await user.click(
        screen
          .getAllByRole("button")
          .find((button) =>
            button.textContent?.startsWith("Source"),
          ) as HTMLButtonElement,
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
      // its empty state and the chips are gone with the cards.
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();
      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(findNativeSelects(document.body)).toHaveLength(0);
    });
  });
});

describe("the agents filter chips", () => {
  describe("when the page renders its sample cards", () => {
    /** @scenario "Source and ownership are filter chips beside the sort chip" */
    it("offers Source, Ownership and Sort as chips and no native select", () => {
      const { container } = renderAgentsAt();

      // Each label on a pressable chip, not merely somewhere on the page:
      // "Ownership" also names a summary card above the tabs, and a page-wide
      // text query would pass on the heading while the chip was missing.
      for (const label of ["Source", "Ownership", "Sort"]) {
        expect(
          screen
            .getAllByRole("button")
            .filter((button) => button.textContent?.startsWith(label)),
        ).toHaveLength(1);
      }
      expect(findNativeSelects(container)).toHaveLength(0);
    });

    /**
     * The old wording of this scenario said the row sits DIRECTLY under the
     * page header, and this test never checked what preceded the row, so the
     * clause was asserted by the spec and verified by nothing. A tab list used
     * to intervene; with the tabs gone the only thing between the header and
     * the chips is the summary strip, which reports the whole fleet and is
     * deliberately not narrowed by them.
     *
     * The clause says the row sits above the content it narrows, and this test
     * checks the position rather than only the grouping.
     */
    /** @scenario "Every filter and sort control sits in one row above the content it narrows" */
    it("keeps every chip in one row above the agents, with only the fleet strip between", () => {
      const { container } = renderAgentsAt();

      const chips = [...container.querySelectorAll('[aria-haspopup="menu"]')];
      expect(chips).toHaveLength(3);
      const rows = new Set(chips.map((chip) => chip.parentElement));
      expect(rows.size).toBe(1);

      // Above the content, never inside it.
      const list = screen.getByTestId("governance-agents-table");
      const row = chips[0]?.parentElement as HTMLElement;
      expect(list.contains(row)).toBe(false);
      expect(
        row.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // And what does intervene reports the whole fleet, which the chips do
      // not narrow — see `summarizeAgentFleet`.
      const strip = screen.getByTestId("agents-summary-strip");
      expect(
        strip.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(strip.contains(row)).toBe(false);
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
      renderAgentsInGrid();

      const card = cardNamed("support-copilot");

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
      renderAgentsInGrid();

      const card = cardNamed("contract-review");

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
    it("leaves only that source's agents", async () => {
      renderAgentsAt();

      await pickFilter("Source", "Databricks");

      await waitFor(() =>
        expect(rowNames()).toEqual([
          "genie-revenue-analyst",
          "genie-supply-planner",
        ]),
      );
    });
  });

  describe("when the reader picks Unclaimed only", () => {
    /** @scenario "Ownership filters down to the agents nobody has claimed" */
    it("leaves only the agents carrying the Unclaimed badge", async () => {
      renderAgentsAt();

      await pickFilter("Ownership", "Unclaimed only");

      await waitFor(() =>
        expect(rowNames()).toEqual([
          "genie-revenue-analyst",
          "churn-predictor",
          "contract-review",
        ]),
      );
      expect(screen.getAllByText("Unclaimed")).toHaveLength(3);
    });

    /**
     * The exception the button rule carves out, bound where the thing it names
     * actually lives. When solid orange left the section's controls, the next
     * reader finishing that job would reasonably have stripped orange from
     * this badge too — it is the same colour and the same word in the grep.
     * It is not the same kind of object: a badge states a fact about an agent
     * and offers nothing to press.
     *
     * Asserted against a badge of known palette rendered beside the page, for
     * the same reason the header actions are: a badge that merely differs from
     * something could be any colour at all.
     */
    /** @scenario "Primary page actions sit top-right in the page header" */
    it("keeps the orange Unclaimed badge, which states a fact rather than offering a press", async () => {
      render(
        <ChakraProvider value={defaultSystem}>
          <Badge size="xs" variant="subtle" colorPalette="orange">
            reference orange badge
          </Badge>
        </ChakraProvider>,
      );
      const orangeBadge = screen.getByText("reference orange badge").className;

      renderAgentsAt();
      await pickFilter("Ownership", "Unclaimed only");

      const badges = await screen.findAllByText("Unclaimed");
      expect(badges).toHaveLength(3);
      for (const badge of badges) expect(badge.className).toBe(orangeBadge);
    });
  });

  describe("when the reader filters every card out of view", () => {
    /**
     * The state a shared empty-state component cannot get right on its own,
     * because it cannot see WHY the list is empty. Copilot Studio is the one
     * source with nothing unclaimed behind it, which is what makes this pair
     * reachable at all.
     */
    /** @scenario "Filtering everything out offers the filters back, not a registration" */
    it("offers the filters back rather than telling the reader to register one", async () => {
      const user = userEvent.setup();
      renderAgentsAt();

      await pickFilter("Source", "Copilot Studio");
      await pickFilter("Ownership", "Unclaimed only");

      const empty = await screen.findByTestId("agents-no-match");
      expect(
        within(empty).getByText(NO_MATCHING_AGENTS_COPY.headline),
      ).toBeVisible();
      // The wrong way out, and the whole point of branching on the reason:
      // this reader has ten agents, not none.
      expect(
        within(empty).queryByRole("button", { name: "Register agent" }),
      ).toBeNull();

      await user.click(
        within(empty).getByRole("button", {
          name: NO_MATCHING_AGENTS_COPY.actionLabel,
        }),
      );

      await waitFor(() =>
        expect(screen.getAllByTestId("governance-agent-row")).toHaveLength(10),
      );
    });

    /**
     * The regression this catches is silent to every other assertion in this
     * file: the button is present, correctly labelled and does the right
     * thing, and is simply drawn wrong.
     *
     * Pinned to reference buttons of known variant rather than merely asserted
     * to differ from the create action. "Different from primary" is not the
     * rule and does not enforce it: the shared component briefly mapped
     * secondary to a solid RED, which is louder than the orange primary and
     * reads as destructive, and a not-equal assertion passes happily through
     * that. Quieter is a specific treatment, so it is compared against one.
     */
    /** @scenario "An empty pane's action is weighted by what it does" */
    it("draws Clear filters ghost and the create actions as the house button", async () => {
      renderAgentsWithReferences(
        "/governance/agents?source=copilot_studio&ownership=unclaimed",
      );

      const ghostSmall = screen.getByText("reference ghost small").className;
      const outlineSmall = screen.getByText(
        "reference outline small",
      ).className;
      const solidSmall = screen.getByText("reference solid small").className;

      const empty = await screen.findByTestId("agents-no-match");
      const clearFilters = within(empty).getByRole("button", {
        name: NO_MATCHING_AGENTS_COPY.actionLabel,
      });
      expect(clearFilters.className).toBe(ghostSmall);
      expect(clearFilters.className).not.toBe(solidSmall);

      // And the create-flow states go the other way, so this is a distinction
      // rather than a blanket demotion of everything in an empty pane. Both
      // halves moved when solid orange left the section — the create action to
      // the house header button and the way out to ghost — and the pair is
      // still two treatments apart, which is the only thing this rule wanted.
      cleanup();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsWithReferences();

      const register = within(screen.getByTestId("agents-empty")).getByRole(
        "button",
        { name: AGENTS_EMPTY_COPY.actionLabel },
      );
      expect(register.className).toBe(outlineSmall);
      // The same treatment the header gives it, which is what stops an empty
      // pane repeating the header's action in a different voice.
      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      expect(register.className).toBe(
        within(headerRow).getByRole("button", { name: /Register agent/ })
          .className,
      );
    });
  });

  describe("when the page has nothing to show", () => {
    /**
     * Both of them, in one pass: nothing registered, and everything filtered
     * out of view. They are the page's two emptinesses and the rule is about
     * every one of them, so checking only the first would leave the branch
     * this page exists to get right unasserted here.
     */
    /** @scenario "Every empty state on the page carries a way out" */
    it("gives each empty state a glyph, a headline, a sentence and a button", async () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      const agentsEmpty = screen.getByTestId("agents-empty");
      expect(
        within(agentsEmpty).getByText(AGENTS_EMPTY_COPY.headline),
      ).toBeVisible();
      expect(
        within(agentsEmpty).getByText(AGENTS_EMPTY_COPY.description),
      ).toBeVisible();
      expect(within(agentsEmpty).getByRole("button")).toBeVisible();
      // A hairline card, never the dashed box this replaced.
      expect(agentsEmpty).not.toHaveStyle({ borderStyle: "dashed" });

      cleanup();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "true");
      renderAgentsAt([
        "/governance/agents?source=copilot_studio&ownership=unclaimed",
      ]);

      const noMatch = await screen.findByTestId("agents-no-match");
      expect(
        within(noMatch).getByText(NO_MATCHING_AGENTS_COPY.headline),
      ).toBeVisible();
      expect(
        within(noMatch).getByText(NO_MATCHING_AGENTS_COPY.description),
      ).toBeVisible();
      expect(within(noMatch).getByRole("button")).toBeVisible();
      expect(noMatch).not.toHaveStyle({ borderStyle: "dashed" });
    });

    /**
     * The section rule, asserted on this page rather than taken on trust from
     * the page that wrote it. The empty pane may repeat the header's create
     * action — that was settled after this page contradicted the first draft
     * of the rule — but it may not invent a second name for it.
     */
    /** @scenario "An empty pane explains itself rather than sitting blank" */
    it("offers the header's own create action rather than a new one", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      const headerLabel = within(headerRow)
        .getByRole("button", { name: /Register agent/ })
        .textContent?.trim();

      const pane = screen.getByTestId("agents-empty");
      expect(within(pane).getByRole("button").textContent?.trim()).toBe(
        headerLabel,
      );

      // Its own words, not the other state's: a shared empty state that also
      // shared its sentences is the failure this rule names.
      expect(NO_MATCHING_AGENTS_COPY.description).not.toBe(
        AGENTS_EMPTY_COPY.description,
      );
    });
  });

  describe("when a reader looks for the way to register something", () => {
    /**
     * One flow, one label, one weight. Label and weight together, because the
     * defect behind this rule was both at once: a solid control up top and an
     * outline one below, worded differently, so a reader had to work out which
     * was real. Same shape as the assertion Inventory makes on Add tool.
     */
    /** @scenario "A page offers one create flow, under one label, from its header" */
    it("opens it under one label at one weight, from the header", async () => {
      const user = userEvent.setup();
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      const buttons = () => screen.getAllByRole("button");
      const named = (label: RegExp) =>
        buttons().filter((b) => label.test(b.textContent ?? ""));

      // No second name for the same room.
      expect(
        named(/\b(add|new|create|connect)\b[^]*agent/i).map(
          (b) => b.textContent,
        ),
      ).toEqual([]);

      const doors = named(/Register agent/);
      expect(doors.length).toBeGreaterThan(1);
      expect(new Set(doors.map((b) => b.className)).size).toBe(1);

      const headerRow = screen.getByRole("heading", { name: "Agents" })
        .parentElement as HTMLElement;
      expect(doors.some((b) => headerRow.contains(b))).toBe(true);

      // And it is one FLOW, not merely one label: the pane's copy opens the
      // same dialog the header does.
      const inPane = doors.find((b) => !headerRow.contains(b));
      await user.click(inPane as HTMLButtonElement);
      expect(
        await screen.findByRole("dialog", { name: /Register an agent/ }),
      ).toBeVisible();
    });
  });

  describe("when the reader sorts by requests", () => {
    /** @scenario "Sorting reorders the agents" */
    it("orders them by request count instead of spend", async () => {
      renderAgentsAt();
      expect(rowNames()[2]).toBe("genie-revenue-analyst");

      await pickFilter("Sort", "Requests");

      await waitFor(() => expect(rowNames()[2]).toBe("fraud-triage"));
      // The agent that never ran sorts last on every ordering: no figure is
      // not the same as the smallest figure.
      expect(rowNames().at(-1)).toBe("contract-review");
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

      // The source badge on the surviving row carries the same word, so the
      // chip is one of two — which is the point: the chip and the list agree.
      expect(screen.getAllByText("Databricks").length).toBe(2);
      expect(screen.getByText("Unclaimed only")).toBeVisible();
      expect(screen.getByText("Requests")).toBeVisible();
      expect(rowNames()).toEqual(["genie-revenue-analyst"]);
    });
  });
});

/**
 * The two layouts.
 *
 * The list is what the page opens on and the cards are the option, which is
 * the shape of every test here: the default is asserted without asking for it,
 * and the grid is asked for by address.
 */
describe("the agents layouts", () => {
  describe("when a governance viewer opens the page", () => {
    /** @scenario "The agents page opens on the list rather than the cards" */
    it("draws the agents as a list, with List chosen on the switch", () => {
      renderAgentsAt();

      expect(screen.getByTestId("governance-agents-table")).toBeVisible();
      expect(rowNames()).toHaveLength(10);
      // Not merely "the table is present": the cards must be absent, or a
      // page rendering both would pass.
      expect(screen.queryAllByTestId("governance-agent-card")).toHaveLength(0);

      const list = screen.getByRole("radio", { name: "List" });
      const grid = screen.getByRole("radio", { name: "Grid" });
      expect(list).toBeChecked();
      expect(grid).not.toBeChecked();
    });

    /**
     * Every column the row type carries, by header text.
     *
     * Asserted against `AGENT_TABLE_COLUMNS` rather than a list retyped here,
     * so a column added to the table without a header — or a header whose
     * words drift from the constant — is caught. The count is pinned too:
     * without it a table that dropped a column would still satisfy a loop
     * over the ones that remain.
     */
    /** @scenario "The list carries every attribute an agent row holds" */
    it("gives each agent attribute its own column, spelled out", () => {
      renderAgentsAt();

      const headers = screen
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim() ?? "");

      expect(headers).toEqual(["Agent", ...AGENT_TABLE_COLUMNS]);
      // The two the card has no room for, and which nothing else on the page
      // shows per agent: the summary strip only counts them across the fleet.
      expect(headers).toContain("Health");
      expect(headers).toContain("Registered");
      // Spelled out, never shortened — the section's copy rule. "30d", "Reqs"
      // and "Env" are the three this table would plausibly have grown.
      for (const header of headers) {
        expect(header).not.toMatch(/\b(30d|Reqs?|Env|Mo|Usd)\b/);
      }
    });

    /** @scenario "A value the list does not have reads as a dash, never a zero" */
    it("draws an unmeasured value as a dash carrying its reason", () => {
      renderAgentsAt();

      const row = rowNamed("contract-review");

      expect(row.textContent).toContain("—");
      expect(row.textContent).not.toContain("$0.00");
      expect(
        row.querySelectorAll(
          '[aria-label="The platform has not measured this yet."]',
        ).length,
      ).toBeGreaterThan(0);
      expect(
        row.querySelector(
          '[aria-label="This agent has registered but has never run."]',
        ),
      ).not.toBeNull();
      // Still a row about a real agent, not four dashes in a line.
      expect(row.textContent).toContain("contract-review");
      expect(row.textContent).toContain("development");
    });
  });

  describe("when the reader chooses Grid", () => {
    /** @scenario "Choosing Grid draws the cards and writes the choice to the address" */
    it("swaps the list for the cards and puts the choice in the address", async () => {
      const user = userEvent.setup();
      const { router } = renderAgentsAt();

      await user.click(screen.getByRole("radio", { name: "Grid" }));

      await waitFor(() =>
        expect(screen.getAllByTestId("governance-agent-card")).toHaveLength(10),
      );
      expect(screen.queryByTestId("governance-agents-table")).toBeNull();
      expect(router.state.location.search).toContain("view=grid");

      // And back, which is the half that proves the default stays out of the
      // address rather than merely being what an empty address renders.
      await user.click(screen.getByRole("radio", { name: "List" }));

      await waitFor(() =>
        expect(router.state.location.search).not.toContain("view"),
      );
      // Awaited rather than read straight after the address: the router's own
      // state settles before React has committed the layout it implies, so a
      // synchronous read here passes or fails on timing rather than on
      // behaviour.
      expect(
        await screen.findByTestId("governance-agents-table"),
      ).toBeVisible();
    });

    /**
     * A figure absent in one layout is absent in the other, wearing the same
     * sentence. Both draw it through `AgentValue`, and this is what would
     * catch the two drifting apart — a second formatter in the table quietly
     * rendering `$0.00` where the card renders a dash.
     */
    /** @scenario "A value the list does not have reads as a dash, never a zero" */
    it("gives the same missing figure the same reason in both layouts", () => {
      renderAgentsAt();
      const reasonInList = rowNamed("contract-review").querySelector(
        '[aria-label="This agent has registered but has never run."]',
      )?.textContent;

      cleanup();
      renderAgentsInGrid();
      const reasonOnCard = cardNamed("contract-review").querySelector(
        '[aria-label="This agent has registered but has never run."]',
      )?.textContent;

      expect(reasonInList).toBe("—");
      expect(reasonOnCard).toBe(reasonInList);
    });
  });

  describe("when there are no agents to lay out", () => {
    /**
     * The switch takes the same gate as the filter chips. Offering a choice
     * of layout over an empty state would be a control that changes nothing,
     * which is the shape of affordance this section keeps removing.
     */
    /** @scenario "The agents page opens on the list rather than the cards" */
    it("offers no layout switch at all", () => {
      window.sessionStorage.setItem(SAMPLE_CHOICE_KEY, "false");
      renderAgentsAt();

      expect(screen.getByTestId("agents-empty")).toBeVisible();
      expect(screen.queryAllByRole("radio")).toHaveLength(0);
    });
  });
});
