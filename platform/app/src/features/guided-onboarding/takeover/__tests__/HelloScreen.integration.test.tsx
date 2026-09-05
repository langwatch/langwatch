/**
 * @vitest-environment jsdom
 *
 * Langy's hello: the greeting types out letter by letter, and Next follows
 * once the words have landed.
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

import { greetingName } from "../copy";
import { HelloScreen } from "../HelloScreen";

afterEach(cleanup);

function renderHello({
  firstName = "Rogerio",
  onNext = vi.fn(),
}: {
  firstName?: string;
  onNext?: () => void;
} = {}) {
  render(
    <ChakraProvider value={defaultSystem}>
      <HelloScreen firstName={firstName} fading={false} onNext={onNext} />
    </ChakraProvider>,
  );
  return { onNext };
}

/** Advances the fake clock far enough for every letter and pause to land. */
function finishTyping() {
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
}

describe("HelloScreen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emitMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the screen opens", () => {
    /** @scenario "Langy greets the user letter by letter and offers Next when the greeting lands" */
    it("types the greeting, keeps Next hidden while typing, then fades Next in", () => {
      renderHello();
      const line = screen.getByTestId("hello-line");

      act(() => {
        vi.advanceTimersByTime(250 + 34 * 4);
      });
      expect(line).toHaveTextContent(/^Hell/);
      expect(line).not.toHaveTextContent("Langy");
      expect(screen.getByTestId("takeover-next")).toHaveAttribute(
        "aria-hidden",
        "true",
      );

      finishTyping();
      expect(line).toHaveTextContent("Hello Rogerio, I'm Langy 👋");
      expect(line).toHaveTextContent("I'll be your guide today.");
      // The greeting gets a beat before Next follows.
      expect(screen.getByTestId("takeover-next")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      act(() => {
        vi.advanceTimersByTime(800);
      });
      const next = screen.getByTestId("takeover-next");
      expect(next).toHaveAttribute("aria-hidden", "false");
      expect(emitMock).toHaveBeenCalledWith("viewed", "hello");
    });

    it("hands the click on Next to the caller", () => {
      const { onNext } = renderHello();
      finishTyping();
      act(() => {
        vi.advanceTimersByTime(800);
      });
      fireEvent.click(screen.getByTestId("takeover-next"));
      expect(onNext).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith("clicked", "next", {
        screen: "hello",
      });
    });
  });

  describe("when the account has no name", () => {
    /** @scenario A user without a first name is greeted as "there" */
    it("greets the user as there", () => {
      expect(greetingName(null)).toBe("there");
      expect(greetingName("   ")).toBe("there");
      expect(greetingName("Rogerio Chaves")).toBe("Rogerio");
      renderHello({ firstName: greetingName(undefined) });
      finishTyping();
      expect(screen.getByTestId("hello-line")).toHaveTextContent(
        "Hello there, I'm Langy",
      );
    });
  });
});
