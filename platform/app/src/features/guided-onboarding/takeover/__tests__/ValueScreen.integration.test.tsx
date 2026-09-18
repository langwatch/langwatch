/**
 * @vitest-environment jsdom
 *
 * The value question: four cards, multi-pick, numbered in pick order, Next
 * with the first pick.
 *
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

import { setupTarget } from "../copy";
import { ValueScreen } from "../ValueScreen";

afterEach(cleanup);

function renderValue({
  target = "ACME",
  onNext = vi.fn(),
}: {
  target?: string;
  onNext?: (paths: string[]) => void;
} = {}) {
  render(
    <ChakraProvider value={defaultSystem}>
      <ValueScreen
        firstName="Rogerio"
        target={target}
        fading={false}
        onNext={onNext}
      />
    </ChakraProvider>,
  );
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  return { onNext };
}

const card = (title: string) => screen.getByRole("button", { name: title });
const order = (id: string) => screen.getByTestId(`pick-order-${id}`);
const next = () => screen.getByTestId("takeover-next");

describe("ValueScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the screen opens", () => {
    /** @scenario "The value question names the organization" */
    it("asks what to set up for the organization by name", () => {
      renderValue({ target: "ACME" });
      expect(screen.getByTestId("value-line")).toHaveTextContent(
        "So tell me, Rogerio, what are the most valuable things we can set up for ACME today?",
      );
      expect(emitMock).toHaveBeenCalledWith("viewed", "value");
    });

    /** @scenario The value question says "you" when the user is on their own */
    it("asks what to set up for you when the user is on their own", () => {
      expect(
        setupTarget({ organizationName: "ACME", usageStyle: "For myself" }),
      ).toBe("you");
      expect(
        setupTarget({ organizationName: "", usageStyle: "For my company" }),
      ).toBe("you");
      expect(
        setupTarget({ organizationName: "ACME", usageStyle: "For my company" }),
      ).toBe("ACME");
      renderValue({ target: "you" });
      expect(screen.getByTestId("value-line")).toHaveTextContent(
        "set up for you today?",
      );
    });

    /** @scenario "The four paths are offered with their titles and descriptions" */
    it("offers the four paths with their descriptions", () => {
      renderValue();
      expect(card("Evals & LLM Ops")).toHaveTextContent(
        "Trace, test and improve the agents you are building",
      );
      expect(card("Coding Agent Tracking")).toHaveTextContent(
        "Track Claude Code and friends and find token savings",
      );
      expect(card("Gateway")).toHaveTextContent(
        "One endpoint for every provider, with virtual keys, budgets and routing",
      );
      expect(card("Governance")).toHaveTextContent(
        "Control all AI subscriptions and usage across company departments",
      );
    });
  });

  describe("when cards are picked", () => {
    /** @scenario "Picking cards numbers them in pick order" */
    it("numbers the cards in the order they were picked", () => {
      renderValue();
      fireEvent.click(card("Gateway"));
      fireEvent.click(card("Evals & LLM Ops"));
      expect(order("gateway")).toHaveTextContent("1");
      expect(order("llmops")).toHaveTextContent("2");
      expect(order("governance")).toHaveTextContent("");
      expect(emitMock).toHaveBeenCalledWith("selected", "path", {
        path: "gateway",
        order: 1,
      });
      expect(emitMock).toHaveBeenCalledWith("selected", "path", {
        path: "llmops",
        order: 2,
      });
    });

    /** @scenario "Unpicking a card renumbers the ones picked after it" */
    it("renumbers the later picks when an earlier one is unpicked", () => {
      renderValue();
      fireEvent.click(card("Gateway"));
      fireEvent.click(card("Evals & LLM Ops"));
      fireEvent.click(card("Governance"));
      fireEvent.click(card("Gateway"));
      expect(order("gateway")).toHaveTextContent("");
      expect(order("llmops")).toHaveTextContent("1");
      expect(order("governance")).toHaveTextContent("2");
      expect(emitMock).toHaveBeenCalledWith("deselected", "path", {
        path: "gateway",
      });
    });

    /** @scenario "Next appears with the first pick" */
    it("shows Next with the first pick and hides it with the last unpick", () => {
      renderValue();
      expect(next()).toHaveAttribute("aria-hidden", "true");
      fireEvent.click(card("Governance"));
      expect(next()).toHaveAttribute("aria-hidden", "false");
      fireEvent.click(card("Governance"));
      expect(next()).toHaveAttribute("aria-hidden", "true");
    });

    it("hands the picks, in order, to the caller on Next", () => {
      const { onNext } = renderValue();
      fireEvent.click(card("Gateway"));
      fireEvent.click(card("Evals & LLM Ops"));
      fireEvent.click(next());
      expect(onNext).toHaveBeenCalledWith(["gateway", "llmops"]);
      expect(emitMock).toHaveBeenCalledWith("clicked", "next", {
        screen: "value",
        paths: ["gateway", "llmops"],
      });
    });
  });
});
