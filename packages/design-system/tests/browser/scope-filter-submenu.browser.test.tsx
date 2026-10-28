/**
 * The project submenu's search field in real Chromium. The shared SearchInput
 * renders `type="search"`, whose native Escape and icon geometry jsdom fakes:
 * it reports a zero box for the icon and never clears a search field.
 * @see specs/api-keys/scope-filter.feature
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { ScopeFilter, type ScopeFilterValue } from "../../src/components/scope/scope-filter.tsx";
import { renderWithDesignSystem } from "../../src/testing/index.tsx";

afterEach(cleanup);

const AVAILABLE = {
  organization: { id: "org_1", name: "ACME" },
  teams: [{ id: "team_1", name: "Platform" }],
  projects: [
    { id: "project_1", name: "Web App", teamId: "team_1" },
    { id: "project_2", name: "Billing API", teamId: "team_1" },
    { id: "project_3", name: "Support Bot", teamId: "team_1" },
  ],
};

function mount() {
  const picked: ScopeFilterValue[] = [];
  renderWithDesignSystem(
    <ScopeFilter
      value={{ kind: "all" }}
      onChange={(next) => picked.push(next)}
      available={AVAILABLE}
      currentTeamId="team_1"
      currentProjectId="project_1"
    />,
  );
  return { picked };
}

async function openProjectSubmenu() {
  await userEvent.click(screen.getByTestId("scope-filter"));
  await userEvent.click(await screen.findByTestId("filter-project-submenu"));
  await expect.poll(() => screen.queryByTestId("filter-project-search")).not.toBeNull();
  return screen.getByTestId("filter-project-search");
}

describe("the project submenu opened in a real engine", () => {
  /** @scenario "The project search box is the shared search field" */
  it("draws the shared field's icon inside the input box, not beside it", async () => {
    mount();
    const search = await openProjectSubmenu();
    const icon = search.closest("div")?.querySelector("svg[aria-hidden='true']");

    expect(icon).not.toBeNull();
    // jsdom reports 0 for every box, so only a real engine can say the icon sits
    // within the field rather than next to it.
    const field = search.getBoundingClientRect();
    const drawn = icon!.getBoundingClientRect();
    expect(drawn.width).toBeGreaterThan(0);
    expect(drawn.left).toBeGreaterThanOrEqual(field.left);
    expect(drawn.right).toBeLessThanOrEqual(field.right);
    expect(drawn.top).toBeGreaterThanOrEqual(field.top);
    expect(drawn.bottom).toBeLessThanOrEqual(field.bottom);
  });

  /** @scenario "Typing in the project search narrows the list by name" */
  it("narrows the list as the engine delivers the keystrokes", async () => {
    mount();
    const search = await openProjectSubmenu();

    await userEvent.fill(search, "bill");

    await expect.poll(() => screen.queryByTestId("filter-project-option-project_2")).not.toBeNull();
    expect(screen.queryByTestId("filter-project-option-project_3")).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  /** @scenario "The project search keeps the menu keyboard controls" */
  it("closes the whole menu on Escape, which a search field could have eaten", async () => {
    const { picked } = mount();
    const search = await openProjectSubmenu();

    await userEvent.fill(search, "bill");
    await userEvent.keyboard("{Escape}");

    // A native search input clears itself on Escape in WebKit-derived engines,
    // so this is the assertion that says the menu still hears the key.
    await expect.poll(() => screen.queryByTestId("filter-project-search")).toBeNull();
    expect(screen.queryByTestId("filter-all")).toBeNull();
    expect(screen.queryByTestId("filter-more-scopes")).toBeNull();
    expect(picked).toEqual([]);
  });
});

describe("the menu's arrows, drawn by the shared menu", () => {
  /** @scenario "The submenu arrow matches the menu's other arrow" */
  it("draws the submenu arrow at the size and right edge of the other one", async () => {
    mount();
    await userEvent.click(screen.getByTestId("scope-filter"));
    await expect.poll(() => screen.queryByTestId("filter-more-scopes")).not.toBeNull();

    const submenuArrow = screen.getByTestId("filter-project-submenu").querySelector("svg");
    const otherArrow = screen.getByTestId("filter-more-scopes").querySelector("svg");

    // jsdom reports a zero box for both, so only a real engine can say the
    // shared menu's arrow matches the one beside it.
    const drawn = submenuArrow!.getBoundingClientRect();
    const other = otherArrow!.getBoundingClientRect();
    expect(drawn.width).toBeGreaterThan(0);
    expect(drawn.width).toBeCloseTo(other.width, 0);
    expect(drawn.height).toBeCloseTo(other.height, 0);
    expect(drawn.right).toBeCloseTo(other.right, 0);
  });
});
