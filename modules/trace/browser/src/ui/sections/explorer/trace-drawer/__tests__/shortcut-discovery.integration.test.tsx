/**
 * Shortcut hints on the drawer's view tabs and the searchable shortcut list.
 * @see modules/trace/specs/shortcut-discovery.feature
 * @vitest-environment jsdom
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { TRACE_DRAWER_SHORTCUTS } from "../../../../../features/trace-drawer/behavior/trace-drawer-shortcut-table.ts";
import { KeyboardShortcutsHelp } from "../keyboard-shortcuts-help.tsx";
import { ModeSwitch } from "../mode-switch.tsx";

afterEach(cleanup);

function renderTabs({ isEditing = false }: { isEditing?: boolean } = {}) {
  return renderWithDesignSystem(
    <ModeSwitch
      viewMode="trace"
      onViewModeChange={vi.fn()}
      hasConversation
      showTerminal
      isEditing={isEditing}
    />,
  );
}

describe("given a coding-agent trace in the drawer", () => {
  describe("when the view tabs render", () => {
    /** @scenario "The Usage view shows the key its handler really uses" */
    it("shows S on Usage and exposes it, with no U anywhere", () => {
      const { container } = renderTabs();
      const usage = screen.getByTestId("trace-mode-tab-usage");
      expect(usage.querySelector("kbd")?.textContent).toBe("S");
      expect(usage).toHaveAttribute("aria-keyshortcuts", "s");
      const letters = [...container.querySelectorAll("kbd")].map((node) => node.textContent);
      expect(letters).not.toContain("U");
    });

    /** @scenario "A view tab that is unavailable advertises no shortcut" */
    it("keeps a disabled tab's chip but exposes no shortcut", () => {
      renderTabs({ isEditing: true });
      const usage = screen.getByTestId("trace-mode-tab-usage");
      expect(usage.querySelector("kbd")).not.toBeNull();
      expect(usage).not.toHaveAttribute("aria-keyshortcuts");
    });
  });
});

describe("given the keyboard shortcuts list is open", () => {
  /** @scenario "The shortcut list is compact, neutral and searchable" */
  it("offers a search field and lists every live drawer shortcut", async () => {
    renderWithDesignSystem(<KeyboardShortcutsHelp open onClose={vi.fn()} />);
    const search = await screen.findByRole("searchbox", { name: "Find a shortcut" });
    expect(search).toBeVisible();
    for (const entry of TRACE_DRAWER_SHORTCUTS) {
      expect(screen.getAllByText(entry.description).length).toBeGreaterThan(0);
    }
    expect(document.querySelector("[data-band-tone], [data-variant='banded']")).toBeNull();
    expect(screen.queryByText(/watch it light up/i)).not.toBeInTheDocument();
  });

  describe("when the reader searches", () => {
    /** @scenario "Search matches an action, a key and a scope" */
    it("matches by action, by key name and by scope", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<KeyboardShortcutsHelp open onClose={vi.fn()} />);
      const search = await screen.findByRole("searchbox", { name: "Find a shortcut" });

      await user.type(search, "refresh");
      expect(screen.getByText("Refresh trace")).toBeInTheDocument();
      expect(screen.queryByText("Copy trace ID")).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "esc");
      expect(screen.getByText("Close drawer / span")).toBeInTheDocument();
      expect(screen.queryByText("Refresh trace")).not.toBeInTheDocument();

      await user.clear(search);
      await user.type(search, "flame graph is focused");
      expect(screen.getByText("Pan the flame graph")).toBeInTheDocument();
      expect(screen.queryByText("Refresh trace")).not.toBeInTheDocument();
    });

    /** @scenario "Search matches an action, a key and a scope" */
    it("says nothing matches when nothing does", async () => {
      const user = userEvent.setup();
      renderWithDesignSystem(<KeyboardShortcutsHelp open onClose={vi.fn()} />);
      await user.type(await screen.findByRole("searchbox"), "zzzz");
      expect(
        screen.getByText("No shortcuts match. Try an action such as Refresh or Find."),
      ).toBeInTheDocument();
    });

    /** @scenario "Escape closes only the shortcut list" */
    it("types without side effects and closes once on Escape", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onKeyDown = vi.fn();
      document.addEventListener("keydown", onKeyDown);
      renderWithDesignSystem(<KeyboardShortcutsHelp open onClose={onClose} />);
      const search = await screen.findByRole("searchbox");
      await user.type(search, "rs?");
      expect(search).toHaveValue("rs?");
      expect(onClose).not.toHaveBeenCalled();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  /** @scenario "Focus returns to a surviving opener" */
  it("returns focus to the fallback control when the opener has left", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [menuOpen, setMenuOpen] = useState(true);
      return (
        <>
          <button type="button" data-testid="fallback">
            More actions
          </button>
          {menuOpen ? (
            <button
              type="button"
              onClick={() => {
                setOpen(true);
                setMenuOpen(false);
              }}
            >
              Keyboard shortcuts
            </button>
          ) : null}
          <KeyboardShortcutsHelp
            open={open}
            onClose={() => setOpen(false)}
            fallbackFocusSelector='[data-testid="fallback"]'
          />
        </>
      );
    }
    renderWithDesignSystem(<Harness />);
    const opener = screen.getByRole("button", { name: "Keyboard shortcuts" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("searchbox");
    await userEvent.setup().keyboard("{Escape}");
    await waitFor(() => expect(screen.getByTestId("fallback")).toHaveFocus());
  });
});
