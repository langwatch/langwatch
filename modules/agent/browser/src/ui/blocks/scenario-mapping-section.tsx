/**
 * The HTTP agent editor's Scenario Mappings: which agent input each scenario
 * field feeds. Stored per agent input, shown per scenario field.
 * @see specs/scenarios/scenario-input-mapping.feature
 */

import { Link } from "@langwatch/browser-host/link";
import { Box, Separator, Text, VStack } from "@langwatch/design-system/primitives";
import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from "@langwatch/design-system/variable-mapping";
import { useMemo } from "react";

const SCENARIO_FIELDS: Variable[] = [
  { identifier: "input", type: "str" },
  { identifier: "messages", type: "str" },
  { identifier: "threadId", type: "str" },
  { identifier: "session", type: "str" },
];

const SCENARIO_INPUT_INFO: Record<string, string> = {
  input: "The latest message from the simulated user",
  messages: "Full conversation history as a JSON string",
  threadId: "Unique identifier for the conversation thread",
  session:
    "The value the agent returned as session on the previous turn of this conversation, empty on the first turn",
};

export type ScenarioMappingSectionProps = {
  /** The agent's declared inputs. */
  inputs: { identifier: string; type?: string }[];
  /** Stored mappings: agent input to the scenario field it reads. */
  mappings: Record<string, FieldMapping>;
  onMappingChange: (identifier: string, mapping: FieldMapping | undefined) => void;
};

/** Stored agent-input mappings, turned round to one row per scenario field. */
function byScenarioField(stored: Record<string, FieldMapping>): Record<string, FieldMapping> {
  const display: Record<string, FieldMapping> = {};
  for (const [agentInput, mapping] of Object.entries(stored)) {
    if (mapping.type === "source" && mapping.path[0]) {
      display[mapping.path[0]] = { type: "source", sourceId: "agent_input", path: [agentInput] };
    }
  }
  return display;
}

export function ScenarioMappingSection({
  inputs,
  mappings,
  onMappingChange,
}: ScenarioMappingSectionProps) {
  const displayMappings = useMemo(() => byScenarioField(mappings), [mappings]);
  const agentSource = useMemo<AvailableSource>(
    () => ({
      id: "agent_input",
      name: "Agent Inputs",
      type: "evaluator",
      fields: inputs.map((input) => ({
        name: input.identifier,
        label: input.identifier,
        type: (input.type ?? "str") as AvailableSource["fields"][number]["type"],
      })),
    }),
    [inputs],
  );
  const valueMappings = Object.entries(mappings).filter(
    (entry): entry is [string, { type: "value"; value: string }] => entry[1].type === "value",
  );
  const missingInputIds = useMemo(
    () =>
      displayMappings.input || displayMappings.messages
        ? new Set<string>()
        : new Set(["input", "messages"]),
    [displayMappings],
  );

  const handleChange = (scenarioField: string, displayMapping: FieldMapping | undefined) => {
    for (const [agentInput, existing] of Object.entries(mappings)) {
      if (existing.type === "source" && existing.path[0] === scenarioField) {
        onMappingChange(agentInput, undefined);
      }
    }
    // A literal has no agent input to bind to here; stored literals show read-only below.
    if (displayMapping?.type === "source" && displayMapping.path[0]) {
      onMappingChange(displayMapping.path[0], {
        type: "source",
        sourceId: "scenario",
        path: [scenarioField],
      });
    }
  };

  return (
    <VStack align="stretch" gap={4}>
      <Separator />
      <VStack align="start" gap={1}>
        <Text fontSize="sm" fontWeight="medium">
          Scenario Mappings
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Configure how this agent connects to the scenario framework. When run as a scenario
          target, these mappings control which data flows in and out.{" "}
          <Link href="https://docs.langwatch.ai/features/scenarios" target="_blank" color="blue.fg">
            Learn more
          </Link>
        </Text>
      </VStack>
      <Box>
        <VariablesSection
          variables={SCENARIO_FIELDS}
          onChange={() => undefined}
          mappings={displayMappings}
          onMappingChange={handleChange}
          availableSources={[agentSource]}
          showMappings
          canAddRemove={false}
          readOnly
          title="Inputs"
          variableInfo={SCENARIO_INPUT_INFO}
          missingMappingIds={missingInputIds}
          optionalHighlighting
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
    </VStack>
  );
}
