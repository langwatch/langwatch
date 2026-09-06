/** @vitest-environment jsdom */
/**
 * Every link out of a Langy card.
 *
 * Clicking "Open in Scenarios" reloaded the whole product: the cards rendered
 * plain anchors, a plain anchor is a real browser navigation, and a real
 * navigation takes the panel, the conversation and any streaming turn with it.
 *
 * @see specs/langy/langy-capability-cards.feature
 *      "A card's links never reload the app"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push }),
}));

const { LangySpaAnchor } = await import("../components/LangySpaAnchor");

const renderAnchor = (href: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <LangySpaAnchor href={href}>Open in Scenarios</LangySpaAnchor>
    </ChakraProvider>,
  );

const click = (init: MouseEventInit = {}) => {
  const link = screen.getByRole("link");
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  fireEvent(link, event);
  return event;
};

describe("LangySpaAnchor", () => {
  beforeEach(() => push.mockClear());

  describe("given an in-app destination", () => {
    beforeEach(() => renderAnchor("/acme/simulations/scenarios"));

    it("stays a real link, so copying and previewing the address still work", () => {
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        "/acme/simulations/scenarios",
      );
    });

    it("routes in-app instead of reloading", () => {
      const event = click();
      expect(push).toHaveBeenCalledWith("/acme/simulations/scenarios");
      expect(event.defaultPrevented).toBe(true);
    });

    it("leaves a command-click to the browser, which is what it means", () => {
      const event = click({ metaKey: true });
      expect(push).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("leaves a middle-click to the browser too", () => {
      const event = click({ button: 1 });
      expect(push).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe("given a destination outside the app", () => {
    // Untouched on purpose: the panel's own external-link guard has to be able
    // to see this click.
    it("neither routes it nor swallows it", () => {
      renderAnchor("https://docs.langwatch.ai/scenarios");
      const event = click();
      expect(push).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it("treats a protocol-relative URL as external", () => {
      renderAnchor("//evil.example.com/scenarios");
      click();
      expect(push).not.toHaveBeenCalled();
    });
  });
});
