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
  describe("when empty", () => {
    it("shows 'Add the first criteria' button", async () => {
      renderWithChakra(
        <CriteriaInput value={[]} onChange={vi.fn()} />,
      );

      await waitFor(() => {
        expect(screen.getByText("Add the first criteria")).toBeInTheDocument();
      });
    });
  });

  describe("when clicking add and saving", () => {
    it("saves criterion on Save click", async () => {
      const onChange = vi.fn();
      renderWithChakra(
        <CriteriaInput value={[]} onChange={onChange} />,
      );

      await waitFor(() => {
        expect(screen.getByText("Add the first criteria")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Add the first criteria"));

      await waitFor(() => {
        expect(screen.getByText("Save")).toBeInTheDocument();
      });

      const input = screen.getByPlaceholderText("Add a criterion...");
      fireEvent.change(input, { target: { value: "New criterion" } });
      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(["New criterion"]);
      });
    });
  });

  describe("when criteria exist", () => {
    it("displays criteria as numbered plain text", async () => {
      renderWithChakra(
        <CriteriaInput
          value={["first", "second", "third"]}
          onChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("first")).toBeInTheDocument();
        expect(screen.getByText("second")).toBeInTheDocument();
        expect(screen.getByText("third")).toBeInTheDocument();
        expect(screen.getByText("1.")).toBeInTheDocument();
        expect(screen.getByText("2.")).toBeInTheDocument();
        expect(screen.getByText("3.")).toBeInTheDocument();
      });
    });

    it("shows 'Add criteria' button below the list", async () => {
      renderWithChakra(
        <CriteriaInput
          value={["first"]}
          onChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("Add criteria")).toBeInTheDocument();
      });
    });

    it("removes criterion via trash button in edit mode", async () => {
      const onChange = vi.fn();
      renderWithChakra(
        <CriteriaInput
          value={["first", "second", "third"]}
          onChange={onChange}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("second")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("second"));

      await waitFor(() => {
        expect(screen.getByLabelText("Delete criterion")).toBeInTheDocument();
      });
      fireEvent.click(screen.getByLabelText("Delete criterion"));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(["first", "third"]);
      });
    });

    it("removes criterion when text is cleared and saved", async () => {
      const onChange = vi.fn();
      renderWithChakra(
        <CriteriaInput
          value={["first", "second", "third"]}
          onChange={onChange}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("second")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("second"));

      await waitFor(() => {
        expect(screen.getByText("Save")).toBeInTheDocument();
      });

      const textarea = screen.getByDisplayValue("second");
      fireEvent.change(textarea, { target: { value: "" } });
      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(["first", "third"]);
      });
    });
  });
});
