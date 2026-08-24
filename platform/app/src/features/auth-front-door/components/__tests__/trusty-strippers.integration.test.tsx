/**
 * @vitest-environment jsdom
 *
 * The strip under the pitch. It used to be five vendor glyphs at 55% opacity,
 * three of which painted near-black on a near-black ground and one of which
 * was an emoji. The tests here pin the three decisions that replaced it — the
 * integrations are NAMED, the names are GROUPED by kind, and the groups sit
 * under a count of what is not shown.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TrustyStrippers } from "../TrustyStrippers";

const renderStrip = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <TrustyStrippers />
    </ChakraProvider>,
  );

describe("given the hosted front door's case panel", () => {
  afterEach(() => cleanup());

  describe("when the strip renders", () => {
    /** @scenario The strip names what LangWatch works with, and how much more there is */
    it("names integrations the reader can recognise", () => {
      renderStrip();

      // Spot-checked across the three kinds of thing the strip has to cover —
      // a model, the framework on top, the tracing underneath — rather than
      // mapped from the module's own array, which would assert the constant
      // back at itself and pass however the strip actually rendered.
      for (const name of ["OpenAI", "LangChain", "OpenTelemetry"]) {
        expect(screen.getByText(name)).toBeTruthy();
      }
    });

    /** @scenario The strip names what LangWatch works with, and how much more there is */
    it("sorts them into the kinds of thing they are", () => {
      renderStrip();

      // Covering models is table stakes; covering the framework on top and
      // the tracing underneath is the claim. It only reads as that claim if
      // the three are separated, so the separation is the assertion.
      const models = screen.getByRole("list", { name: "Models" });
      const frameworks = screen.getByRole("list", { name: "Frameworks" });
      const sdks = screen.getByRole("list", { name: "SDKs" });

      expect(within(models).getByText("OpenAI")).toBeTruthy();
      expect(within(frameworks).getByText("LangChain")).toBeTruthy();
      expect(within(sdks).getByText("OpenTelemetry")).toBeTruthy();
      expect(within(models).queryByText("LangChain")).toBeNull();
    });

    /** @scenario The strip names what LangWatch works with, and how much more there is */
    it("says how many more there are than the ones it shows", () => {
      renderStrip();

      const label = screen.getByTestId("front-door-integrations-label");
      const shown = screen
        .getByTestId("front-door-integrations")
        .querySelectorAll("li").length;

      // The shape, not the figure: a count that can be raised without
      // rewriting a test is a count somebody will actually keep current.
      expect(label.textContent).toMatch(/\d+\+ integrations/i);
      const claimed = Number(/(\d+)\+/.exec(label.textContent ?? "")?.[1]);
      expect(shown).toBeGreaterThan(0);
      expect(claimed).toBeGreaterThan(shown);
    });

    /** @scenario The strip names what LangWatch works with, and how much more there is */
    it("shows no customer's mark and no vendor's mark", () => {
      const { container } = renderStrip();

      // A logo here is either somebody else's endorsement we have not been
      // given, or a 20px glyph the reader has to guess at. Neither belongs on
      // a strip whose whole job is to be recognised at a glance.
      expect(container.querySelectorAll("svg, img")).toHaveLength(0);
    });

    it("gives the grid the label as its accessible name", () => {
      renderStrip();

      const label = screen.getByTestId("front-door-integrations-label");
      const grid = screen.getByTestId("front-door-integrations");

      expect(grid.getAttribute("aria-labelledby")).toBe(label.id);
      expect(label.id).toBeTruthy();
    });
  });
});
