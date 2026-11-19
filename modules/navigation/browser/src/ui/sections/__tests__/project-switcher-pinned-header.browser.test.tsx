/**
 * Real-Chromium project switcher: a row the keyboard highlights scrolls into view below the
 * pinned header and search field, never under them. Real scrolling, which jsdom cannot measure.
 * Spec: specs/navigation/project-switcher-current-project.feature
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";

vi.mock("../../../behavior/user/use-user-avatar-url.ts", () => ({
  useUserAvatarUrl: (image?: string | null) => image ?? null,
}));

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ProductScopeControl } from "../product-scope-control.tsx";

const PROJECT_COUNT = 30;
const projects = Array.from({ length: PROJECT_COUNT }, (_, index) => ({
  id: `project_${index}`,
  slug: `project-${index}`,
  name: `Project ${String(index).padStart(2, "0")}`,
  isPersonal: false,
}));
const coreTeam = {
  id: "team_1",
  name: "Core",
  isPersonal: false,
  ownerUserId: null,
  members: [{ userId: "user_1" }],
  projects,
};
const organization = { id: "org_1", name: "ACME", teams: [coreTeam] };

afterEach(() => cleanup());

function renderSwitcher() {
  renderWithDesignSystem(
    <WithStubNavigationHost
      readings={{
        organizations: [organization],
        organization,
        project: projects[0],
        team: coreTeam,
        openableTeams: [coreTeam],
        currentUser: { id: "user_1", name: "Ada", email: "ada@acme.test", image: null },
        isLoading: false,
        pathname: "/project-0",
        permissions: ["project:update"],
      }}
      actions={{ navigate: vi.fn() }}
    >
      <ProductScopeControl activeProductId="llm-ops" />
    </WithStubNavigationHost>,
  );
}

function highlightedRow() {
  const row = document.querySelector<HTMLElement>('[role="option"][data-highlighted]');
  if (!row) throw new Error("no highlighted row");
  return row;
}

/** The pinned block is the search field's sticky ancestor, the direct child of the listbox. */
function pinnedBlock() {
  const field = screen.getByRole("combobox", { name: "Search projects" });
  const listbox = screen.getByRole("listbox");
  let node: HTMLElement | null = field;
  while (node && node.parentElement !== listbox) node = node.parentElement;
  if (!node) throw new Error("search field is not inside the listbox");
  return { node, listbox };
}

describe("the project switcher's pinned header", () => {
  describe("when the keyboard walks a list longer than the popup", () => {
    /** @scenario The list keeps a highlighted row clear of the pinned header */
    it("scrolls each highlighted row into view below the pinned block", async () => {
      renderSwitcher();
      await userEvent.click(screen.getByRole("button", { name: "Switch project" }));
      await waitFor(() => {
        expect(screen.getByRole("combobox", { name: "Search projects" })).toHaveFocus();
      });
      const { node: pinned, listbox } = pinnedBlock();
      expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight);
      expect(listbox.style.scrollPaddingTop).toBe(`${pinned.offsetHeight}px`);

      for (let step = 0; step < PROJECT_COUNT - 1; step++) await userEvent.keyboard("{ArrowDown}");
      await waitFor(() => expect(highlightedRow().textContent).toContain("Project 29"));
      expect(listbox.scrollTop).toBeGreaterThan(0);

      for (let step = PROJECT_COUNT - 2; step >= 0; step--) {
        await userEvent.keyboard("{ArrowUp}");
        const label = `Project ${String(step).padStart(2, "0")}`;
        await waitFor(() => expect(highlightedRow().textContent).toContain(label));
        await waitFor(() => {
          const rowTop = highlightedRow().getBoundingClientRect().top;
          expect(rowTop).toBeGreaterThanOrEqual(pinned.getBoundingClientRect().bottom - 1);
        });
      }
    });
  });
});
