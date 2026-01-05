/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { ScenarioForm, type ScenarioFormData } from "../ScenarioForm";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { UseFormReturn } from "react-hook-form";

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
}

describe("ScenarioForm", () => {
  describe("when rendering", () => {
    it("displays all section headers", () => {
      renderWithChakra(<ScenarioForm />);

      expect(screen.getByText("Scenario")).toBeInTheDocument();
      expect(screen.getByText("Situation")).toBeInTheDocument();
      expect(screen.getByText("Criteria")).toBeInTheDocument();
    });

    it("displays name input with placeholder", () => {
      renderWithChakra(<ScenarioForm />);

      expect(screen.getByPlaceholderText("e.g., Angry refund request")).toBeInTheDocument();
    });

    it("displays situation textarea", () => {
      renderWithChakra(<ScenarioForm />);

      expect(
        screen.getByPlaceholderText("Describe the context and setup for this scenario...")
      ).toBeInTheDocument();
    });

    it("displays labels section", () => {
      renderWithChakra(<ScenarioForm />);

      expect(screen.getByText("Labels")).toBeInTheDocument();
    });
  });

  describe("when provided defaultValues", () => {
    it("populates name field", () => {
      renderWithChakra(
        <ScenarioForm defaultValues={{ name: "Test Scenario" }} />
      );

      expect(screen.getByDisplayValue("Test Scenario")).toBeInTheDocument();
    });

    it("populates situation field", () => {
      renderWithChakra(
        <ScenarioForm defaultValues={{ situation: "User is frustrated" }} />
      );

      expect(screen.getByDisplayValue("User is frustrated")).toBeInTheDocument();
    });

    it("populates labels", () => {
      renderWithChakra(
        <ScenarioForm defaultValues={{ labels: ["billing", "urgent"] }} />
      );

      expect(screen.getByText("billing")).toBeInTheDocument();
      expect(screen.getByText("urgent")).toBeInTheDocument();
    });

    it("populates criteria", () => {
      renderWithChakra(
        <ScenarioForm defaultValues={{ criteria: ["Be polite", "Resolve issue"] }} />
      );

      expect(screen.getByDisplayValue("Be polite")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Resolve issue")).toBeInTheDocument();
    });
  });

  describe("when exposing form via formRef", () => {
    it("calls formRef with form instance", () => {
      const formRef = vi.fn();
      renderWithChakra(<ScenarioForm formRef={formRef} />);

      expect(formRef).toHaveBeenCalled();
      expect(formRef.mock.calls[0][0]).toHaveProperty("handleSubmit");
      expect(formRef.mock.calls[0][0]).toHaveProperty("getValues");
    });

    it("exposes form with current values", async () => {
      const user = userEvent.setup();
      let formInstance: UseFormReturn<ScenarioFormData> | null = null;
      const formRef = (form: UseFormReturn<ScenarioFormData>) => {
        formInstance = form;
      };

      renderWithChakra(<ScenarioForm formRef={formRef} />);

      await user.type(screen.getByPlaceholderText("e.g., Angry refund request"), "My Scenario");

      await waitFor(() => {
        expect(formInstance?.getValues("name")).toBe("My Scenario");
      });
    });
  });

  describe("when interacting with form", () => {
    it("updates name field on type", async () => {
      const user = userEvent.setup();
      renderWithChakra(<ScenarioForm />);

      const nameInput = screen.getByPlaceholderText("e.g., Angry refund request");
      await user.type(nameInput, "New Scenario Name");

      expect(nameInput).toHaveValue("New Scenario Name");
    });

    it("updates situation field on type", async () => {
      const user = userEvent.setup();
      renderWithChakra(<ScenarioForm />);

      const situationInput = screen.getByPlaceholderText(
        "Describe the context and setup for this scenario..."
      );
      await user.type(situationInput, "Customer is angry about a billing error");

      expect(situationInput).toHaveValue("Customer is angry about a billing error");
    });

    it("adds label through InlineTagsInput", async () => {
      const user = userEvent.setup();
      renderWithChakra(<ScenarioForm />);

      // Initially no tags, so input is visible
      const labelInput = screen.getByPlaceholderText("Label name...");
      await user.type(labelInput, "billing");
      await user.click(screen.getByRole("button", { name: "Add" }));

      expect(screen.getByText("billing")).toBeInTheDocument();
    });

    it("adds criterion through CriteriaInput", async () => {
      const user = userEvent.setup();
      renderWithChakra(<ScenarioForm />);

      const criteriaInput = screen.getByPlaceholderText("Add a criterion...");
      await user.type(criteriaInput, "Respond within 24 hours");
      await user.click(screen.getByRole("button", { name: /add/i }));

      expect(screen.getByDisplayValue("Respond within 24 hours")).toBeInTheDocument();
    });
  });
});

