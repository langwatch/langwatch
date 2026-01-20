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
import { CriteriaInput } from "../CriteriaInput";

afterEach(() => {
  cleanup();
});

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("CriteriaInput", () => {
  it("adds criterion on button click", async () => {
    const onChange = vi.fn();
    renderWithChakra(<CriteriaInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Add a criterion..."),
      ).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Add a criterion...");
    fireEvent.change(input, { target: { value: "New criterion" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["New criterion"]);
    });
  });

  it("ignores empty input", async () => {
    const onChange = vi.fn();
    renderWithChakra(<CriteriaInput value={[]} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByText("Add")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Add"));

    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes criterion on close click", async () => {
    const onChange = vi.fn();
    renderWithChakra(
      <CriteriaInput
        value={["first", "second", "third"]}
        onChange={onChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("second")).toBeInTheDocument();
    });

    const secondInput = screen.getByDisplayValue("second");
    const closeButton = secondInput.parentElement?.querySelector("button");
    fireEvent.click(closeButton!);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(["first", "third"]);
    });
  });
});
