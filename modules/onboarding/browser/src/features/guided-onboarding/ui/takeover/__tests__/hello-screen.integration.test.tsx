/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const emitMock = vi.fn();

vi.mock("react-contextual-analytics", () => ({
  useAnalytics: () => ({ emit: emitMock }),
}));

import { HelloScreen } from "../hello-screen.tsx";

function renderHello(onNext = vi.fn()) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <HelloScreen firstName="Ada" fading={false} onNext={onNext} />
    </ChakraProvider>,
  );
}

describe("HelloScreen", () => {
  beforeEach(() => {
    emitMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  /** @scenario "Langy greets the reader by name before anything else runs" */
  it("types the greeting and announces the screen was viewed", async () => {
    renderHello();
    await waitFor(() => expect(screen.getByTestId("hello-line")).toHaveTextContent(/Hello Ada/));
    expect(emitMock).toHaveBeenCalledWith("viewed", "hello");
  });

  /** @scenario "Next only appears once the greeting has finished typing" */
  it("hides Next until the greeting has fully typed", async () => {
    renderHello();
    expect(screen.getByTestId("takeover-next")).toHaveAttribute("aria-hidden", "true");
    await waitFor(
      () => expect(screen.getByTestId("takeover-next")).toHaveAttribute("aria-hidden", "false"),
      { timeout: 8000 },
    );
  }, 10000);

  it("emits the click and calls onNext when Next is pressed", async () => {
    const onNext = vi.fn();
    renderHello(onNext);
    await waitFor(
      () => expect(screen.getByTestId("takeover-next")).toHaveAttribute("aria-hidden", "false"),
      { timeout: 8000 },
    );
    screen.getByTestId("takeover-next").click();
    expect(onNext).toHaveBeenCalled();
    expect(emitMock).toHaveBeenCalledWith("clicked", "next", { screen: "hello" });
  }, 10000);
});
