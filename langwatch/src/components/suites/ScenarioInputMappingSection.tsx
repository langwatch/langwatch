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
  createListCollection,
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
import { Select } from "~/components/ui/select";

/** The three scenario fields shown as input mapping rows. */
const SCENARIO_FIELDS: Variable[] = [
  { identifier: "scenario_message", type: "str" },
  { identifier: "conversation_history", type: "str" },
  { identifier: "thread_id", type: "str" },
];

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
        sourceId: "agent",
        path: [agentInput],
      };
    }
  }
  return display;
}

function buildAgentInputSource(inputs: Variable[]): AvailableSource {
  return {
    id: "agent",
    name: "Agent Inputs",
    type: "evaluator",
    fields: inputs.map((inp) => ({
      name: inp.identifier,
      label: inp.identifier,
      type: inp.type ?? "str",
    })),
  };
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

  const outputCollection = useMemo(
    () =>
      createListCollection({
        items: (outputs ?? []).map((o) => ({
          label: o.identifier,
          value: o.identifier,
        })),
      }),
    [outputs],
  );

  const hasMultipleOutputs = (outputs ?? []).length >= 2;
  const autoOutputLabel = outputs?.[0]?.identifier ?? "output";
  const selectedOutputValues = useMemo(
    () => (outputField ? [outputField] : [autoOutputLabel]),
    [outputField, autoOutputLabel],
  );

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
        />
      </Box>

      {/* Output mapping */}
      {outputs !== undefined && (
        <Box>
          {hasMultipleOutputs ? (
            <VStack align="stretch" gap={2}>
              <Text
                fontSize="xs"
                fontWeight="bold"
                textTransform="uppercase"
                color="fg.muted"
              >
                Output
              </Text>
              <Select.Root
                collection={outputCollection}
                value={selectedOutputValues}
                onValueChange={(details) => {
                  const selected = details.value[0];
                  onOutputFieldChange?.(selected ?? undefined);
                }}
                size="sm"
              >
                <Select.Trigger>
                  <Select.ValueText placeholder="Select output field" />
                </Select.Trigger>
                <Select.Content>
                  {outputCollection.items.map((item) => (
                    <Select.Item key={item.value} item={item}>
                      <Select.ItemText>{item.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </VStack>
          ) : (
            <VariablesSection
              variables={[{ identifier: autoOutputLabel, type: (outputs[0]?.type ?? "str") }]}
              onChange={() => {}}
              canAddRemove={false}
              readOnly={true}
              title="Output"
            />
          )}
        </Box>
      )}
    </VStack>
  );
}
