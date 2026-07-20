/**
 * @vitest-environment jsdom
 *
 * The search-bar tips moved out of a lightbulb popover into the single
 * keyboard-shortcuts dialog, and the dead "Find a facet" shortcut is gone.
 * See specs/traces-v2/search.feature ("Search tips live in the keyboard
 * shortcuts dialog").
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../../../stores/uiStore", () => ({
  useUIStore: (selector: (s: unknown) => unknown) =>
    selector({
      shortcutsHelpOpen: true,
      setShortcutsHelpOpen: vi.fn(),
    }),
}));

import { PageKeyboardShortcuts } from "../PageKeyboardShortcuts";

afterEach(() => cleanup());

function renderDialog() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PageKeyboardShortcuts />
    </ChakraProvider>,
  );
}

describe("PageKeyboardShortcuts", () => {
  describe("given the shortcuts dialog is open", () => {
    it("shows a Search section with the former search tips", () => {
      renderDialog();
      expect(screen.getByText("Search")).toBeInTheDocument();
      expect(screen.getByText(/ask ai to build a query/i)).toBeInTheDocument();
      expect(screen.getByText(/flip it in place/i)).toBeInTheDocument();
    });

    it("no longer lists the removed Find a facet shortcut", () => {
      renderDialog();
      expect(screen.queryByText(/find a facet/i)).not.toBeInTheDocument();
    });
  });
});
