/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { InlineTagsInput } from "../InlineTagsInput";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

afterEach(() => {
  cleanup();
});

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("InlineTagsInput", () => {
  it("adds tag on button click", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Label name...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Label name...");
    fireEvent.change(input, { target: { value: "newlabel" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["newlabel"]);
    });
  });

  it("trims whitespace", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Label name...")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Label name...");
    fireEvent.change(input, { target: { value: "  spaced  " } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["spaced"]);
    });
  });

  it("ignores empty input", async () => {
    const onChange = vi.fn();
    renderWithChakra(<InlineTagsInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText("Add")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes tag on close click", async () => {
    const onChange = vi.fn();
    renderWithChakra(
      <InlineTagsInput value={["first", "second", "third"]} onChange={onChange} />
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


