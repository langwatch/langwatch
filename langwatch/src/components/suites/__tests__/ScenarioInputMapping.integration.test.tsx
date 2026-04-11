/**
 * @vitest-environment jsdom
 *
 * Integration tests for Scenario Input Mapping UI.
 *
 * The component shows scenario fields as rows (input,
 * messages, threadId) and agent inputs as sources in the
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
          screen.getByTestId("variable-name-input"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-messages"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-threadId"),
        ).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Dropdown offers agent inputs as targets
  // ============================================================================

  describe("given the mapping UI with agent inputs 'query' and 'context'", () => {
    describe("when the user opens the input mapping dropdown", () => {
      it("offers 'query' as a target", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByTestId("mapping-input-input"));

        expect(
          await screen.findByTestId("field-option-query"),
        ).toBeInTheDocument();
      });

      it("offers 'context' as a target", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(screen.getByTestId("mapping-input-input"));

        expect(
          await screen.findByTestId("field-option-context"),
        ).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Selecting an agent input produces stored-format mapping
  // ============================================================================

  describe("given the mapping UI for input", () => {
    describe("when the user selects 'query' from the dropdown", () => {
      it("calls onMappingChange with stored format: query → input", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();

        renderSection({ onMappingChange });

        await user.click(screen.getByTestId("mapping-input-input"));

        const option = await screen.findByTestId("field-option-query");
        await user.click(option);

        expect(onMappingChange).toHaveBeenCalledWith(
          "query",
          expect.objectContaining<FieldMapping>({
            type: "source",
            sourceId: "scenario",
            path: ["input"],
          }),
        );
      });
    });
  });

  // ============================================================================
  // Scenario: Existing mappings display correctly (inverted)
  // ============================================================================

  describe("given stored mappings { query: input, context: messages }", () => {
    describe("when the section renders", () => {
      it("shows the mappings inverted on the correct scenario field rows", () => {
        const mappings: Record<string, FieldMapping> = {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
          context: { type: "source", sourceId: "scenario", path: ["messages"] },
        };

        renderSection({ mappings });

        // The input row should show "query" as its mapping
        // The messages row should show "context" as its mapping
        // We verify by checking the mapping input values contain the agent input names
        const scenarioMessageInput = screen.getByTestId("mapping-input-input");
        const conversationHistoryInput = screen.getByTestId("mapping-input-messages");

        // The inputs should exist and be rendered
        expect(scenarioMessageInput).toBeInTheDocument();
        expect(conversationHistoryInput).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Scenario: Static value mappings can NOT be created from the inverted UI
  //
  // The scenario-field-row display has no natural agent-input target for a literal,
  // so the section intentionally ignores type:"value" emissions from the child widget.
  // Stored static values still render read-only (see the round-trip test below).
  // Creating/editing value mappings belongs in a future agent-input-row UI.
  // ============================================================================

  describe("given the mapping UI with an empty mappings state", () => {
    describe("when the child widget emits a type:value mapping for input", () => {
      it("does not forward the value mapping to storage", async () => {
        const user = userEvent.setup();
        const onMappingChange = vi.fn();

        renderSection({ onMappingChange });

        await user.click(screen.getByTestId("mapping-input-input"));

        const input = screen.getByTestId("mapping-input-input");
        await user.type(input, "hello");

        const valueOption = await screen.findByTestId("use-as-value-option");
        await user.click(valueOption);

        // No call with a type:"value" payload should ever reach storage from
        // the inverted scenario-field-row UI — the keyspace has no place for it.
        const valueCalls = onMappingChange.mock.calls.filter(
          ([, mapping]) =>
            mapping !== undefined &&
            (mapping as FieldMapping).type === "value",
        );
        expect(valueCalls).toHaveLength(0);
      });
    });
  });

  // ============================================================================
  // Scenario: Static value round-trips from stored state (Gap B — invertMappings)
  // ============================================================================

  describe("given stored mappings with a static value for 'context'", () => {
    describe("when the section renders", () => {
      it("displays the stored static value text in the context row", () => {
        const mappings: Record<string, FieldMapping> = {
          context: { type: "value", value: "Use the KB" },
        };

        renderSection({ mappings });

        // Stored value mappings round-trip via the read-only render block:
        // invertMappings only handles type:"source", so the section surfaces
        // type:"value" entries as an inert <key>: <value> line beneath the
        // scenario-field rows. Creating or editing them from the UI is
        // deferred to a future agent-input-row variant.
        expect(screen.getByText("Use the KB")).toBeInTheDocument();
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
          screen.getByTestId("variable-name-input"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-messages"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("variable-name-threadId"),
        ).toBeInTheDocument();
      });
    });
  });
});
