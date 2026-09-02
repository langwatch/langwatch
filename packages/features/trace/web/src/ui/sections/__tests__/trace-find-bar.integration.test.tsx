// @vitest-environment jsdom

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TraceFindBar, useFindStore, type TraceSearchItem } from "../../../index";

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  useFindStore.getState().close();
});

const traces: TraceSearchItem[] = [
  {
    traceId: "trace-1",
    name: "Support request",
    serviceName: "gateway",
    input: "Reset password",
    output: "Done",
    models: [],
    evaluations: [],
    events: { groups: [] },
  },
];

const renderFindBar = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <table>
        <tbody data-trace-id="trace-1">
          <tr>
            <td>Support request</td>
          </tr>
        </tbody>
      </table>
      <TraceFindBar traces={traces} renderShortcutKey={(label) => <kbd>{label}</kbd>} />
    </ChakraProvider>,
  );

describe("TraceFindBar", () => {
  beforeEach(() => {
    useFindStore.getState().open();
  });

  it("searches loaded rows and cycles to the matching row", () => {
    const { container } = renderFindBar();

    const input = screen.getByRole("textbox", { name: "Find query" });
    fireEvent.change(input, { target: { value: "reset" } });

    expect(screen.getByText("1 of 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next match" })).not.toBeDisabled();
    expect(container.querySelector('tbody[data-trace-id="trace-1"]')).toHaveAttribute(
      "data-current-find-match",
    );
  });

  it("closes on Escape and keeps the keyboard hint as a named render port", () => {
    renderFindBar();

    expect(screen.getByRole("note", { name: "Find shortcut hint" })).toHaveTextContent(
      /(?:⌘|Ctrl) F/,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Find query" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("search", { name: "Find on page" })).not.toBeInTheDocument();
    expect(useFindStore.getState().isOpen).toBe(false);
  });
});
