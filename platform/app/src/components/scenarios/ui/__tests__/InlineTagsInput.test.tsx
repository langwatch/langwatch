/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineTagsInput } from "../InlineTagsInput";

afterEach(() => {
  cleanup();
});

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("InlineTagsInput", () => {
  it("adds tag on Enter key", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add label...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Add label...");
    fireEvent.change(input, { target: { value: "newlabel" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["newlabel"]);
    });
  });

  it("trims whitespace", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add label...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Add label...");
    fireEvent.change(input, { target: { value: "  spaced  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["spaced"]);
    });
  });

  it("ignores empty input on Enter", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Add label...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Add label...");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes tag on close click", async () => {
    const onChange = vi.fn();
    renderWithChakra(
      <InlineTagsInput
        value={["first", "second", "third"]}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("second")).toBeInTheDocument();
    });

    const secondTag = screen.getByText("second").parentElement;
    const closeButton = secondTag?.querySelector("button");
    fireEvent.click(closeButton!);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["first", "third"]);
    });
  });
});
