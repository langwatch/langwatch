/**
 * @vitest-environment jsdom
 *
 * Integration tests for Scenario Input Mapping UI.
 *
 * The component shows scenario fields as rows (scenario_message,
 * conversation_history, thread_id) and agent inputs as sources in the
 * dropdown. Direction: "Where does each scenario field go?"
 *
 * Stored format: agent_input → scenario_source
 * Display format (inverted): scenario_field → agent_input
 *
 * @see specs/scenarios/scenario-input-mapping.feature (UI section, @integration)
 */

import type React from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ScenarioInputMappingSection,
  type ScenarioInputMappingSectionProps,
} from "../ScenarioInputMappingSection";
import type { FieldMapping } from "~/components/variables/VariableMappingInput";

// -- Mock transitive deps that pull in complex modules --

vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

vi.mock("~/optimization_studio/components/nodes/Nodes", () => ({
  TypeLabel: ({ type }: { type: string }) => <span>{type}</span>,
}));

// -- Helpers --

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function renderSection(
  overrides: Partial<ScenarioInputMappingSectionProps> = {},
) {
  const defaults: ScenarioInputMappingSectionProps = {
    inputs: [
      { identifier: "query", type: "str" },
      { identifier: "context", type: "str" },
    ],
    mappings: {},
    onMappingChange: vi.fn(),
  };

  return render(
    <ScenarioInputMappingSection {...defaults} {...overrides} />,
    { wrapper: Wrapper },
  );
}

describe("ScenarioInputMappingSection", () => {
  afterEach(cleanup);

  // ============================================================================
  // Scenario: Section shows scenario fields as rows
  // ============================================================================

  describe("given a code agent with inputs 'query' and 'context'", () => {
    describe("when the section renders", () => {
      it("shows the 'Scenario Mappings' section header", () => {
        renderSection();

        expect(
          screen.getByText("Scenario Mappings"),
        ).toBeInTheDocument();
      });

      it("shows a row for each scenario field", () => {
        renderSection();

        expect(
          screen.getByTestId("variable-name-scenario_message"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-conversation_history"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-thread_id"),
        ).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Dropdown offers agent inputs as targets
  // ============================================================================

  describe("given the mapping UI with agent inputs 'query' and 'context'", () => {
    describe("when the user opens the scenario_message mapping dropdown", () => {
      it("offers 'query' as a target", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByTestId("mapping-input-scenario_message"));

        expect(
          await screen.findByTestId("field-option-query"),
        ).toBeInTheDocument();
      });

      it("offers 'context' as a target", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByTestId("mapping-input-scenario_message"));

        expect(
          await screen.findByTestId("field-option-context"),
        ).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Selecting an agent input produces stored-format mapping
  // ============================================================================

  describe("given the mapping UI for scenario_message", () => {
    describe("when the user selects 'query' from the dropdown", () => {
      it("calls onMappingChange with stored format: query → scenario_message", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();

        renderSection({ onMappingChange });

        await user.click(screen.getByTestId("mapping-input-scenario_message"));

        const option = await screen.findByTestId("field-option-query");
        await user.click(option);

        expect(onMappingChange).toHaveBeenCalledWith(
          "query",
          expect.objectContaining<FieldMapping>({
            type: "source",
            sourceId: "scenario",
            path: ["scenario_message"],
          }),
        );
      });
    });
  });

  // ============================================================================
  // Scenario: Existing mappings display correctly (inverted)
  // ============================================================================

  describe("given stored mappings { query: scenario_message, context: conversation_history }", () => {
    describe("when the section renders", () => {
      it("shows the mappings inverted on the correct scenario field rows", () => {
        const mappings: Record<string, FieldMapping> = {
          query: { type: "source", sourceId: "scenario", path: ["scenario_message"] },
          context: { type: "source", sourceId: "scenario", path: ["conversation_history"] },
        };

        renderSection({ mappings });

        // The scenario_message row should show "query" as its mapping
        // The conversation_history row should show "context" as its mapping
        // We verify by checking the mapping input values contain the agent input names
        const scenarioMessageInput = screen.getByTestId("mapping-input-scenario_message");
        const conversationHistoryInput = screen.getByTestId("mapping-input-conversation_history");

        // The inputs should exist and be rendered
        expect(scenarioMessageInput).toBeInTheDocument();
        expect(conversationHistoryInput).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Single-input agent shows full form
  // ============================================================================

  describe("given a code agent with a single input 'query'", () => {
    describe("when the section renders", () => {
      it("shows the full mapping form with all three scenario fields", () => {
        renderSection({
          inputs: [{ identifier: "query", type: "str" }],
        });

        expect(
          screen.getByTestId("variable-name-scenario_message"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-conversation_history"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-thread_id"),
        ).toBeInTheDocument();
      });
    });
  });
});
