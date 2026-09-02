/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandBarLangyMode } from "../command-bar-langy-mode";

/**
 * The mark the HOST hands over, standing in for the assistant's own.
 *
 * It carries the class the real one does, because what this suite pins is that
 * whatever the host handed is drawn in the composer — not which drawing it is.
 * The assistant's package owns the mark, and a shell package may not import it.
 */
const HOST_LANGY_MARK = <span className="langy-mark" aria-hidden />;

function renderMode(
  overrides: Partial<{
    query: string;
    exiting: boolean;
    onQueryChange: (value: string) => void;
    onSubmit: () => void;
    onExit: () => void;
  }> = {},
) {
  const props = {
    query: "why did checkout slow down?",
    exiting: false,
    onQueryChange: vi.fn(),
    onSubmit: vi.fn(),
    onExit: vi.fn(),
    mark: HOST_LANGY_MARK,
    ...overrides,
  };

  const view = render(
    <ChakraProvider value={defaultSystem}>
      <CommandBarLangyMode {...props} />
    </ChakraProvider>,
  );

  return { ...view, props };
}

afterEach(cleanup);

describe("CommandBarLangyMode", () => {
  it("draws the mark the host handed over and focuses the carried query", () => {
    const { container } = renderMode();
    const input = screen.getByRole("textbox", { name: "Ask Langy" });

    expect(input).toHaveFocus();
    expect(input).toHaveValue("why did checkout slow down?");
    expect(container.querySelector("[data-langy-command-mode='true']")).not.toBeNull();
    expect(container.querySelector(".langy-mark")).not.toBeNull();
    expect(container.querySelector(".langy-composer-sheen")).not.toBeNull();
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });

  it("submits on plain Enter but preserves modified Enter", () => {
    const onSubmit = vi.fn();
    renderMode({ onSubmit });
    const input = screen.getByRole("textbox", { name: "Ask Langy" });

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses Escape as a mode-level back action without closing the parent surface", () => {
    const onExit = vi.fn();
    const parentKeyDown = vi.fn();
    render(
      <ChakraProvider value={defaultSystem}>
        <div onKeyDown={parentKeyDown}>
          <CommandBarLangyMode
            query="question"
            onQueryChange={() => undefined}
            onSubmit={() => undefined}
            onExit={onExit}
            exiting={false}
          />
        </div>
      </ChakraProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ask Langy" }), {
      key: "Escape",
    });

    expect(onExit).toHaveBeenCalledTimes(1);
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("steps back on Backspace only when the field is already empty", () => {
    const onExit = vi.fn();
    const { rerender } = render(
      <ChakraProvider value={defaultSystem}>
        <CommandBarLangyMode
          query="question"
          onQueryChange={() => undefined}
          onSubmit={() => undefined}
          onExit={onExit}
          exiting={false}
        />
      </ChakraProvider>,
    );
    const input = screen.getByRole("textbox", { name: "Ask Langy" });

    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onExit).not.toHaveBeenCalled();

    rerender(
      <ChakraProvider value={defaultSystem}>
        <CommandBarLangyMode
          query=""
          onQueryChange={() => undefined}
          onSubmit={() => undefined}
          onExit={onExit}
          exiting={false}
        />
      </ChakraProvider>,
    );
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("becomes read-only and ignores duplicate submits during handoff", () => {
    const onSubmit = vi.fn();
    renderMode({ exiting: true, onSubmit });
    const input = screen.getByRole("textbox", { name: "Ask Langy" });

    expect(input).toHaveAttribute("aria-busy", "true");
    expect(input).toHaveAttribute("readonly");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
