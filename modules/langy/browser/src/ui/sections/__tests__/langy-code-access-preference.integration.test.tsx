/**
 * @vitest-environment jsdom
 *
 * The remembered code-access choice, as the Integrations screen shows it once one is stored.
 * @see specs/langy/langy-code-access.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LangyCodeAccessPreference } from "../langy-code-access-preference.tsx";

const onClear = vi.fn();

afterEach(cleanup);
beforeEach(() => onClear.mockClear());

const renderBlock = ({ standalone = false }: { standalone?: boolean }) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangyCodeAccessPreference standalone={standalone} isClearing={false} onClear={onClear} />
    </ChakraProvider>,
  );

describe("given GitHub was remembered for code changes", () => {
  describe("when the reader presses Change in the GitHub section", () => {
    /** @scenario "The remembered choice can be cleared from the integrations settings" */
    it("says so, and asks to clear the choice", () => {
      renderBlock({});

      expect(screen.getByText("Langy uses GitHub for code changes")).toBeDefined();
      fireEvent.click(screen.getByText("Change"));

      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });

  describe("when it stands in a card of its own, outside the GitHub card", () => {
    /** @scenario "The remembered choice can be cleared from the integrations settings" */
    it("titles the card and still asks to clear the choice", () => {
      renderBlock({ standalone: true });

      expect(screen.getByText("Langy code access")).toBeDefined();
      fireEvent.click(screen.getByText("Change"));

      expect(onClear).toHaveBeenCalledTimes(1);
    });
  });
});
