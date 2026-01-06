/**
 * @vitest-environment jsdom
 */
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { InlineTagsInput } from "../InlineTagsInput";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("InlineTagsInput", () => {
  describe("when there are no tags", () => {
    it("shows input field immediately", () => {
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={vi.fn()} />
      );

      expect(screen.getByPlaceholderText("Label name...")).toBeInTheDocument();
    });

    it("shows Add button", () => {
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={vi.fn()} />
      );

      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("does not show Cancel button", () => {
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={vi.fn()} />
      );

      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });
  });

  describe("when there are existing tags", () => {
    it("displays all tags", () => {
      renderWithChakra(
        <InlineTagsInput value={["test", "billing"]} onChange={vi.fn()} />
      );

      expect(screen.getByText("test")).toBeInTheDocument();
      expect(screen.getByText("billing")).toBeInTheDocument();
    });

    it("shows '+ Add Label' button instead of input", () => {
      renderWithChakra(
        <InlineTagsInput value={["test"]} onChange={vi.fn()} />
      );

      expect(screen.getByRole("button", { name: "+ Add Label" })).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("Label name...")).not.toBeInTheDocument();
    });

    it("shows input and Cancel when clicking '+ Add Label'", async () => {
      const user = userEvent.setup();
      renderWithChakra(
        <InlineTagsInput value={["test"]} onChange={vi.fn()} />
      );

      await user.click(screen.getByRole("button", { name: "+ Add Label" }));

      expect(screen.getByPlaceholderText("Label name...")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });
  });

  describe("when adding a tag", () => {
    it("calls onChange with new tag on Add click", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={onChange} />
      );

      await user.type(screen.getByPlaceholderText("Label name..."), "newlabel");
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(onChange).toHaveBeenCalledWith(["newlabel"]);
    });

    it("calls onChange with new tag on Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <InlineTagsInput value={["existing"]} onChange={onChange} />
      );

      await user.click(screen.getByRole("button", { name: "+ Add Label" }));
      await user.type(screen.getByPlaceholderText("Label name..."), "newlabel{enter}");

      expect(onChange).toHaveBeenCalledWith(["existing", "newlabel"]);
    });

    it("does not call onChange with empty input", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={onChange} />
      );

      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(onChange).not.toHaveBeenCalled();
    });

    it("trims whitespace from input", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <InlineTagsInput value={[]} onChange={onChange} />
      );

      await user.type(screen.getByPlaceholderText("Label name..."), "  spaced  ");
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(onChange).toHaveBeenCalledWith(["spaced"]);
    });
  });

  describe("when canceling", () => {
    it("hides input on Cancel click", async () => {
      const user = userEvent.setup();
      renderWithChakra(
        <InlineTagsInput value={["test"]} onChange={vi.fn()} />
      );

      await user.click(screen.getByRole("button", { name: "+ Add Label" }));
      expect(screen.getByPlaceholderText("Label name...")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByPlaceholderText("Label name...")).not.toBeInTheDocument();
    });

    it("hides input on Escape", async () => {
      const user = userEvent.setup();
      renderWithChakra(
        <InlineTagsInput value={["test"]} onChange={vi.fn()} />
      );

      await user.click(screen.getByRole("button", { name: "+ Add Label" }));
      await user.type(screen.getByPlaceholderText("Label name..."), "{escape}");

      expect(screen.queryByPlaceholderText("Label name...")).not.toBeInTheDocument();
    });

    it("clears input value on Cancel", async () => {
      const user = userEvent.setup();
      renderWithChakra(
        <InlineTagsInput value={["test"]} onChange={vi.fn()} />
      );

      await user.click(screen.getByRole("button", { name: "+ Add Label" }));
      await user.type(screen.getByPlaceholderText("Label name..."), "partial");
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "+ Add Label" }));

      expect(screen.getByPlaceholderText("Label name...")).toHaveValue("");
    });
  });

  describe("when removing a tag", () => {
    it("calls onChange without removed tag", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <InlineTagsInput value={["first", "second", "third"]} onChange={onChange} />
      );

      // Find the close button for "second" tag
      const secondTag = screen.getByText("second").parentElement;
      const closeButton = secondTag?.querySelector("button");

      await user.click(closeButton!);

      expect(onChange).toHaveBeenCalledWith(["first", "third"]);
    });
  });
});

