/**
 * @vitest-environment jsdom
 *
 * @see specs/prompts/editing-modes.feature
 *   ("The mode title reads as clickable without hovering")
 *
 * The Prompt/Messages mode title is a menu trigger, so it has to read as
 * clickable on its own — a chevron next to the title, visible before any
 * hover, rather than only appearing on `:hover`.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditingModeTitle } from "../editing-mode-title";

afterEach(() => cleanup());

function renderTitle() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <EditingModeTitle mode="prompt" onChange={() => undefined} />
    </ChakraProvider>,
  );
}

describe("<EditingModeTitle/>", () => {
  describe("given the prompt editor is open", () => {
    /** @scenario The mode title reads as clickable without hovering */
    it("shows the chevron next to the title without hovering", () => {
      renderTitle();

      const chevron = screen.getByTestId("editing-mode-chevron");
      expect(chevron).toBeInTheDocument();
      expect(window.getComputedStyle(chevron).opacity).not.toBe("0");
      expect(window.getComputedStyle(chevron).display).not.toBe("none");
      expect(window.getComputedStyle(chevron).visibility).not.toBe("hidden");
    });
  });
});
