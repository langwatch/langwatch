import { Box, Tag as ChakraTag, Text, VStack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Drawer } from "../overlays/drawer.tsx";
import { Button } from "./button.tsx";
import {
  FieldEditor,
  FieldEditorName,
  FieldEditorRemove,
  FieldEditorRow,
} from "./field-editor.tsx";

type Field = { id: string; type: string; info?: string; mapped?: string; schema?: boolean };

type SectionProps = {
  label: string;
  noun: string;
  fields: Field[];
  readOnly?: boolean;
  invalidId?: string;
  lastLocked?: boolean;
  withValue?: boolean;
};

function valueFor(field: Field, withValue?: boolean): ReactNode {
  if (field.schema) {
    return (
      <Button size="xs" variant="ghost">
        JSON Schema
      </Button>
    );
  }
  if (!withValue) return undefined;
  return (
    <ChakraTag.Root colorPalette="blue" maxWidth="full">
      <ChakraTag.Label truncate>{field.mapped ?? "Entry.input"}</ChakraTag.Label>
    </ChakraTag.Root>
  );
}

function Section({
  label,
  noun,
  fields,
  readOnly,
  invalidId,
  lastLocked,
  withValue,
}: SectionProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <FieldEditor
      label={label}
      empty={fields.length === 0}
      emptyMessage={`No ${noun}s defined`}
      addAction={
        readOnly ? undefined : (
          <Button size="xs" variant="outline" aria-label={`Add ${noun}`}>
            <Plus size={14} />
            Add
          </Button>
        )
      }
    >
      {fields.map((field) => (
        <FieldEditorRow
          key={field.id}
          typeControl={
            <Button size="xs" variant="outline" colorPalette="gray" fontWeight="normal">
              {field.type}
            </Button>
          }
          nameControl={
            <FieldEditorName
              value={field.id}
              editing={editing === field.id}
              draft={draft}
              readOnly={readOnly}
              invalid={invalidId === field.id}
              ariaLabel={`${label} name ${field.id}`}
              onStartEdit={() => {
                setDraft(field.id);
                setEditing(field.id);
              }}
              onDraftChange={setDraft}
              onCommit={() => setEditing(null)}
              onCancel={() => setEditing(null)}
              displayTestId={`name-${field.id}`}
              inputTestId={`name-input-${field.id}`}
            />
          }
          info={
            field.info ? (
              <Text as="span" tabIndex={0} color="fg.subtle" title={field.info}>
                i
              </Text>
            ) : undefined
          }
          separator={
            <Text color="fg.subtle" fontFamily="mono" textStyle="bodySm">
              =
            </Text>
          }
          valueLabel={field.schema ? "Schema" : "Mapping"}
          value={valueFor(field, withValue)}
          removeAction={
            readOnly ? undefined : (
              <FieldEditorRemove
                label={`Remove ${noun} ${field.id}`}
                tooltip={
                  lastLocked && fields.length === 1
                    ? `At least one ${noun} is required`
                    : `Remove ${noun}`
                }
                disabled={lastLocked && fields.length === 1}
                onClick={() => undefined}
              />
            )
          }
        />
      ))}
    </FieldEditor>
  );
}

type PairProps = {
  variables?: Field[];
  outputs?: Field[];
  readOnly?: boolean;
  invalidId?: string;
  lastLocked?: boolean;
  width?: number;
  withValue?: boolean;
};

const VARIABLES: Field[] = [
  { id: "input", type: "Text", info: "The user's message", mapped: "Entry.input" },
  { id: "context", type: "List", mapped: "Entry.retrieved_documents" },
];
const OUTPUTS: Field[] = [
  { id: "output", type: "Text" },
  { id: "result", type: "JSON", schema: true },
];

function Pair({
  variables = VARIABLES,
  outputs = OUTPUTS,
  readOnly,
  invalidId,
  lastLocked,
  width = 640,
  withValue = true,
}: PairProps): ReactNode {
  return (
    <Box width={`${width}px`} maxWidth="100%">
      <VStack align="stretch" gap={6}>
        <Section
          label="Variables"
          noun="variable"
          fields={variables}
          readOnly={readOnly}
          invalidId={invalidId}
          withValue={withValue}
        />
        <Section
          label="Outputs"
          noun="output"
          fields={outputs}
          readOnly={readOnly}
          lastLocked={lastLocked}
        />
      </VStack>
    </Box>
  );
}

const meta = {
  title: "Inputs and forms/Field editor",
  parameters: {
    usage: {
      use: "A short editable list of typed, named fields, such as a prompt's Variables and Outputs. Every section shares one column grid, so type, name and remove line up between lists. The mapping chip here is a presentation-only specimen.",
      avoid:
        "A record table (ListTable), a read-only label and value list (SummaryList), or a general schema form builder.",
    },
  },
  component: FieldEditor,
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj;

export const Default: Story = { render: () => <Pair /> };
export const Empty: Story = { render: () => <Pair variables={[]} outputs={[]} /> };
export const One: Story = {
  render: () => <Pair variables={VARIABLES.slice(0, 1)} outputs={OUTPUTS.slice(0, 1)} />,
};
export const Many: Story = {
  render: () => (
    <Pair
      variables={[
        ...VARIABLES,
        { id: "language", type: "Text" },
        { id: "history", type: "Messages" },
      ]}
    />
  ),
};
export const LongNames: Story = {
  render: () => (
    <Pair
      variables={[
        {
          id: "an_extremely_long_unbroken_variable_name_that_must_not_push_the_info_away",
          type: "Text",
          info: "Long name",
          mapped: "Entry.a.very.long.nested.path.that.keeps.going.and.going",
        },
      ]}
      outputs={[{ id: "an_extremely_long_unbroken_output_name_for_the_grid", type: "Text" }]}
    />
  ),
};
export const WithMapping: Story = { render: () => <Pair withValue /> };
export const WithoutMapping: Story = {
  render: () => <Pair withValue={false} />,
};
export const ReadOnly: Story = { render: () => <Pair readOnly /> };
export const DefinitionsReadOnlyMappingsEditable: Story = {
  render: () => <Pair readOnly withValue />,
};
export const DisabledLastOutput: Story = {
  render: () => <Pair outputs={OUTPUTS.slice(0, 1)} lastLocked />,
};
export const InvalidName: Story = { render: () => <Pair invalidId="input" /> };
export const Narrow: Story = { render: () => <Pair width={320} /> };
export const InDrawer: Story = {
  render: () => (
    <Drawer.Root open size="md">
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>Prompt</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Pair width={420} />
        </Drawer.Body>
        <Drawer.Actions primary={<Button>Save</Button>} />
      </Drawer.Content>
    </Drawer.Root>
  ),
};
