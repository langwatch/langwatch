/**
 * Scenario Mappings Section
 *
 * A visually distinct section in the agent editor that configures how
 * the agent interacts with the scenario framework.
 *
 * Contains two sub-sections:
 * - Input mapping: which agent input receives each scenario field
 * - Output mapping: which output field is the agent's response
 *
 * Stored format (on agent config) maps agent_input → scenario_source.
 * Display format is inverted: scenario_field → agent_input.
 */

import {
  Box,
  Link,
  Separator,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo } from "react";
import { VariablesSection } from "~/components/variables/VariablesSection";
import type {
  AvailableSource,
  FieldMapping,
} from "~/components/variables/VariableMappingInput";
import type { Variable } from "~/components/variables/VariablesSection";

/** The three scenario fields shown as input mapping rows. */
const SCENARIO_FIELDS: Variable[] = [
  { identifier: "input", type: "str" },
  { identifier: "messages", type: "str" },
  { identifier: "threadId", type: "str" },
];

const SCENARIO_INPUT_INFO: Record<string, string> = {
  input: "The latest message from the simulated user",
  messages: "Full conversation history as a JSON string",
  threadId: "Unique identifier for the conversation thread",
};

/** The single scenario output field. */
const SCENARIO_OUTPUT_FIELD: Variable[] = [
  { identifier: "output", type: "str" },
];

const SCENARIO_OUTPUT_INFO: Record<string, string> = {
  output: "The agent's response sent back to the scenario",
};

export type ScenarioInputMappingSectionProps = {
  /** Declared inputs for the agent (identifier + type). */
  inputs: Variable[];
  /**
   * Current mappings in stored format: agent_input → scenario_source.
   * This component inverts them for display.
   */
  mappings: Record<string, FieldMapping>;
  /** Called with updated mappings in stored format (agent_input → scenario_source). */
  onMappingChange: (
    identifier: string,
    mapping: FieldMapping | undefined,
  ) => void;
  /** Declared outputs for the agent. */
  outputs?: Variable[];
  /** Currently selected output field identifier for the scenario result. */
  outputField?: string;
  /** Called when the output field selection changes. */
  onOutputFieldChange?: (field: string | undefined) => void;
};

function invertMappings(
  stored: Record<string, FieldMapping>,
): Record<string, FieldMapping> {
  const display: Record<string, FieldMapping> = {};
  for (const [agentInput, mapping] of Object.entries(stored)) {
    if (mapping.type === "source" && mapping.path[0]) {
      const scenarioField = mapping.path[0];
      display[scenarioField] = {
        type: "source",
        sourceId: "agent_input",
        path: [agentInput],
      };
    }
  }
  return display;
}

function buildAgentInputSource(inputs: Variable[]): AvailableSource {
  return {
    id: "agent_input",
    name: "Agent Inputs",
    type: "evaluator",
    fields: inputs.map((inp) => ({
      name: inp.identifier,
      label: inp.identifier,
      type: inp.type ?? "str",
    })),
  };
}

function buildAgentOutputSource(outputs: Variable[]): AvailableSource {
  return {
    id: "agent_output",
    name: "Agent Outputs",
    type: "evaluator",
    fields: outputs.map((out) => ({
      name: out.identifier,
      label: out.identifier,
      type: out.type ?? "str",
    })),
  };
}

/**
 * Checks whether the scenario mappings are valid.
 * - At least one of input or messages must be mapped.
 * - An output must be selected (not cleared).
 */
export function isScenarioMappingValid({
  mappings,
  outputs,
  outputField,
}: {
  mappings: Record<string, FieldMapping>;
  outputs?: Variable[];
  outputField?: string;
}): boolean {
  const mappedPaths = Object.values(mappings)
    .filter((m) => m.type === "source")
    .map((m) => m.path[0]);
  const hasRequiredInput =
    mappedPaths.includes("input") ||
    mappedPaths.includes("messages");
  const hasOutputs = (outputs ?? []).length > 0;
  // outputField === "" means explicitly cleared; undefined means auto-populate
  const hasOutputMapping = hasOutputs && outputField !== "";
  return hasRequiredInput && hasOutputMapping;
}

export function ScenarioInputMappingSection({
  inputs,
  mappings,
  onMappingChange,
  outputs,
  outputField,
  onOutputFieldChange,
}: ScenarioInputMappingSectionProps) {
  const displayMappings = useMemo(() => invertMappings(mappings), [mappings]);
  const agentSource = useMemo(() => buildAgentInputSource(inputs), [inputs]);

  const valueMappings = useMemo(
    () =>
      Object.entries(mappings).filter(
        (entry): entry is [string, { type: "value"; value: string }] =>
          entry[1].type === "value",
      ),
    [mappings],
  );

  const agentOutputSource = useMemo(
    () => buildAgentOutputSource(outputs ?? []),
    [outputs],
  );

  const hasOutputs = (outputs ?? []).length > 0;
  const autoOutputLabel = outputs?.[0]?.identifier ?? "output";
  // undefined = not yet set (auto-populate), "" = explicitly cleared, string = user selection
  const selectedOutput = outputField === undefined ? autoOutputLabel : outputField;
  const hasOutputMapping = selectedOutput !== "" && hasOutputs;

  const outputDisplayMappings = useMemo<Record<string, FieldMapping>>(
    () =>
      hasOutputMapping
        ? {
            output: {
              type: "source",
              sourceId: "agent_output",
              path: [selectedOutput],
            },
          }
        : ({} as Record<string, FieldMapping>),
    [hasOutputMapping, selectedOutput],
  );

  const missingOutputIds = useMemo(
    () => (hasOutputMapping ? new Set<string>() : new Set(["output"])),
    [hasOutputMapping],
  );

  // Validation: at least one of input or messages must be mapped
  const missingInputIds = useMemo(() => {
    const hasInput = !!displayMappings["input"];
    const hasMessages = !!displayMappings["messages"];
    if (hasInput || hasMessages) return new Set<string>();
    return new Set(["input", "messages"]);
  }, [displayMappings]);

  const handleOutputMappingChange = (
    _scenarioField: string,
    displayMapping: FieldMapping | undefined,
  ) => {
    if (displayMapping?.type === "source" && displayMapping.path[0]) {
      onOutputFieldChange?.(displayMapping.path[0]);
    } else {
      // Empty string signals "explicitly cleared" vs undefined which means "not yet set"
      onOutputFieldChange?.("");
    }
  };

  const handleDisplayMappingChange = (
    scenarioField: string,
    displayMapping: FieldMapping | undefined,
  ) => {
    for (const [agentInput, existing] of Object.entries(mappings)) {
      if (existing.type === "source" && existing.path[0] === scenarioField) {
        onMappingChange(agentInput, undefined);
      }
    }

    if (displayMapping?.type === "source" && displayMapping.path[0]) {
      const agentInput = displayMapping.path[0];
      onMappingChange(agentInput, {
        type: "source",
        sourceId: "scenario",
        path: [scenarioField],
      });
    }
    // Static value mappings are not editable from this inverted UI:
    // a scenario-field row has no natural agent-input target to bind a literal to.
    // Existing type:"value" entries render read-only below; creating or editing them
    // belongs in a follow-up that rebuilds the section with agent-input rows.
  };

  return (
    <VStack align="stretch" gap={4}>
      <Separator />

      {/* Section header */}
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="medium">
          Scenario Mappings
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Configure how this agent connects to the scenario framework.
          When run as a scenario target, these mappings control which data
          flows in and out.{" "}
          <Link
            href="https://docs.langwatch.ai/features/scenarios"
            target="_blank"
            color="blue.fg"
          >
            Learn more
          </Link>
        </Text>
      </VStack>

      {/* Input mapping */}
      <Box>
        <VariablesSection
          variables={SCENARIO_FIELDS}
          onChange={() => {}}
          mappings={displayMappings}
          onMappingChange={handleDisplayMappingChange}
          availableSources={[agentSource]}
          showMappings={true}
          canAddRemove={false}
          readOnly={true}
          title="Inputs"
          variableInfo={SCENARIO_INPUT_INFO}
          missingMappingIds={missingInputIds}
          optionalHighlighting={true}
          showMissingMappingsError={false}
        />
        {missingInputIds.size > 0 && (
          <Text fontSize="xs" color="fg.error" marginTop={1}>
            Map at least one of: input or messages
          </Text>
        )}
        {valueMappings.length > 0 && (
          <VStack align="stretch" gap={1} marginTop={2}>
            {valueMappings.map(([identifier, mapping]) => (
              <Box key={identifier}>
                <Text as="span" fontSize="xs" color="fg.muted" fontFamily="mono">
                  {identifier}
                </Text>
                <Text as="span" fontSize="xs" color="fg.muted">
                  {": "}
                </Text>
                <Text as="span" fontSize="xs">
                  {mapping.value}
                </Text>
              </Box>
            ))}
          </VStack>
        )}
      </Box>

      {/* Output mapping */}
      {outputs !== undefined && (
        <Box>
          <VariablesSection
            variables={SCENARIO_OUTPUT_FIELD}
            onChange={() => {}}
            mappings={outputDisplayMappings}
            onMappingChange={handleOutputMappingChange}
            availableSources={[agentOutputSource]}
            showMappings={true}
            canAddRemove={false}
            readOnly={true}
            title="Output"
            variableInfo={SCENARIO_OUTPUT_INFO}
            missingMappingIds={missingOutputIds}
            showMissingMappingsError={false}
          />
          {(outputs ?? []).length === 0 && (
            <Text fontSize="xs" color="fg.error" marginTop={1}>
              Add at least one output to the agent
            </Text>
          )}
        </Box>
      )}
    </VStack>
  );
}
