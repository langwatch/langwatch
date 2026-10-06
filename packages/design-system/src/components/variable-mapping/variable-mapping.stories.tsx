import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { Box } from "../../primitives.ts";
import {
  type AvailableSource,
  type FieldMapping,
  type Variable,
  VariablesSection,
} from "./index.ts";

const SOURCES: AvailableSource[] = [
  {
    id: "dataset-1",
    name: "Customer questions",
    type: "dataset",
    fields: [
      { name: "question", type: "str" },
      { name: "expected_answer", type: "str" },
      { name: "history", type: "chat_messages" },
    ],
  },
];

const VARIABLES: Variable[] = [
  { identifier: "question", type: "str" },
  { identifier: "context", type: "list[str]" },
];

function MappedVariables(props: {
  variables: Variable[];
  initialMappings?: Record<string, FieldMapping>;
  isMappingDisabled?: boolean;
  missing?: string[];
  width?: string;
}) {
  const [mappings, setMappings] = useState(props.initialMappings ?? {});
  return (
    <Box width={props.width ?? "480px"}>
      <VariablesSection
        title="Input Variables"
        variables={props.variables}
        onChange={() => undefined}
        showMappings
        canAddRemove={false}
        availableSources={SOURCES}
        mappings={mappings}
        onMappingChange={(identifier, mapping) => {
          const { [identifier]: _previous, ...rest } = mappings;
          setMappings(mapping ? { ...rest, [identifier]: mapping } : rest);
        }}
        {...(props.isMappingDisabled ? { isMappingDisabled: true } : {})}
        {...(props.missing ? { missingMappingIds: new Set(props.missing) } : {})}
      />
    </Box>
  );
}

const meta = {
  title: "Components/Variable mapping",
  component: MappedVariables,
  tags: ["autodocs"],
  args: { variables: VARIABLES },
} satisfies Meta<typeof MappedVariables>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unmapped: Story = {};

export const Mapped: Story = {
  args: {
    initialMappings: {
      question: { type: "source", sourceId: "dataset-1", path: ["question"] },
      context: { type: "value", value: "Our refund window is 30 days." },
    },
  },
};

export const MissingMapping: Story = { args: { missing: ["question"] } };

export const Disabled: Story = { args: { isMappingDisabled: true } };

export const Empty: Story = { args: { variables: [] } };

export const LongNamesNarrow: Story = {
  args: {
    width: "280px",
    variables: [
      { identifier: "a_very_long_variable_name_that_keeps_going_and_going", type: "str" },
    ],
  },
};

/** The editable form a prompt or code evaluator shows: add, rename, retype, remove. */
export const Editable: Story = {
  render: () => {
    const [variables, setVariables] = useState<Variable[]>(VARIABLES);
    return (
      <Box width="480px">
        <VariablesSection variables={variables} onChange={setVariables} canAddRemove />
      </Box>
    );
  },
};
