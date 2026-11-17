/**
 * @vitest-environment jsdom
 * @see specs/features/onboarding/guided-welcome-takeover.feature
 */
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();
vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

import { firstNameOf } from "../../../model/tour-landing.ts";
import { HelloScreen } from "../hello-screen.tsx";

afterEach(cleanup);

function renderHello({
  firstName,
  onNext = vi.fn(),
}: {
  firstName: string | undefined;
  onNext?: () => void;
}) {
  render(
    <DesignSystemProvider forcedTheme="light">
      <HelloScreen firstName={firstName} fading={false} onNext={onNext} />
    </DesignSystemProvider>,
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
      renderHello({ firstName: "Rogerio" });
      const line = screen.getByTestId("hello-line");

      act(() => {
        vi.advanceTimersByTime(250 + 34 * 4);
      });
      expect(line).toHaveTextContent(/^Hell/);
      expect(line).not.toHaveTextContent("Langy");
      expect(screen.getByTestId("takeover-next")).toHaveAttribute("aria-hidden", "true");

      finishTyping();
      expect(line).toHaveTextContent("Hello Rogerio, I'm Langy 👋");
      expect(line).toHaveTextContent("I'll be your guide today.");
      // The greeting gets a beat before Next follows.
      expect(screen.getByTestId("takeover-next")).toHaveAttribute("aria-hidden", "true");
      act(() => {
        vi.advanceTimersByTime(800);
      });
      const next = screen.getByTestId("takeover-next");
      expect(next).toHaveAttribute("aria-hidden", "false");
      expect(emitMock).toHaveBeenCalledWith("viewed", "hello");
    });

    it("hands the click on Next to the caller", () => {
      const { onNext } = renderHello({ firstName: "Rogerio" });
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
    /** @scenario A user without a name is greeted without a placeholder */
    it.each([null, "", "   ", "ada@acme.com"])("greets %j with a bare Hello", (name) => {
      renderHello({ firstName: firstNameOf(name) });
      finishTyping();
      const line = screen.getByTestId("hello-line");
      expect(line).toHaveTextContent(/^Hello, I'm Langy 👋/);
      expect(line).not.toHaveTextContent(/\bthere\b|ada@acme/i);
    });
  });
});
