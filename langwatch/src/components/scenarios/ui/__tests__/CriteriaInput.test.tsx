/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CriteriaInput } from "../CriteriaInput";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

afterEach(() => {
  cleanup();
});

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("CriteriaInput", () => {
  describe("when there are no criteria", () => {
    it("shows input field with placeholder", () => {
      renderWithChakra(<CriteriaInput value={[]} onChange={vi.fn()} />);

      expect(
        screen.getByPlaceholderText("Add a criterion...")
      ).toBeInTheDocument();
    });

    it("shows Add button", () => {
      renderWithChakra(<CriteriaInput value={[]} onChange={vi.fn()} />);

      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });
  });

  describe("when there are existing criteria", () => {
    it("displays all criteria", () => {
      renderWithChakra(
        <CriteriaInput
          value={["Agent responds politely", "Issue is resolved"]}
          onChange={vi.fn()}
        />
      );

      expect(
        screen.getByDisplayValue("Agent responds politely")
      ).toBeInTheDocument();
      expect(screen.getByDisplayValue("Issue is resolved")).toBeInTheDocument();
    });

    it("shows input for adding new criterion", () => {
      renderWithChakra(
        <CriteriaInput value={["existing"]} onChange={vi.fn()} />
      );

      expect(
        screen.getByPlaceholderText("Add a criterion...")
      ).toBeInTheDocument();
    });
  });

  describe("when adding a criterion", () => {
    it("calls onChange with new criterion on Add click", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(<CriteriaInput value={[]} onChange={onChange} />);

      await user.type(
        screen.getByPlaceholderText("Add a criterion..."),
        "New criterion"
      );
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(onChange).toHaveBeenCalledWith(["New criterion"]);
    });

    it("calls onChange with new criterion on Enter", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <CriteriaInput value={["existing"]} onChange={onChange} />
      );

      await user.type(
        screen.getByPlaceholderText("Add a criterion..."),
        "New criterion{enter}"
      );

      expect(onChange).toHaveBeenCalledWith(["existing", "New criterion"]);
    });

    it("clears input after adding", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(<CriteriaInput value={[]} onChange={onChange} />);

      const input = screen.getByPlaceholderText("Add a criterion...");
      await user.type(input, "New criterion");
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(input).toHaveValue("");
    });

    it("does not call onChange with empty input", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(<CriteriaInput value={[]} onChange={onChange} />);

      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe("when removing a criterion", () => {
    it("calls onChange without removed criterion", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      renderWithChakra(
        <CriteriaInput value={["first", "second", "third"]} onChange={onChange} />
      );

      // Find the close button for "second" criterion
      const secondInput = screen.getByDisplayValue("second");
      const row = secondInput.parentElement;
      const closeButton = row?.querySelector("button");

      await user.click(closeButton!);

      expect(onChange).toHaveBeenCalledWith(["first", "third"]);
    });
  });
});
