import { Box, Button, Card, Heading, HStack, Input, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Database } from "lucide-react";

import { DoDont } from "../../.storybook/do-dont.tsx";
import { VerticalFormControl } from "../components/forms/vertical-form-control.tsx";
import { NoDataInfoBlock } from "../components/states/no-data-info-block.tsx";

const meta = {
  title: "Patterns/Using them together",
  parameters: {
    usage: {
      use: "Tokens set the values, primitives lay them out, components carry the behaviour. A screen is a Page layout, then sections, then cards or a List table, spaced on the scale.",
      avoid:
        "Margins on children, pixel values, and a component rebuilt from primitives because it was quicker than finding it.",
    },
    docs: {
      description: {
        component: [
          "**Spacing rhythm.** The parent sets the gap; children carry no margins. Inside a card `gap={2}` to `gap={3}`, between cards `gap={4}`, between sections of a page `gap={8}` to `gap={10}`.",
          "",
          "**Page, section, card.** Page layout gives the header and container; Settings section gives a band its title and purpose; a Card or Settings card groups the facts of one thing.",
          "",
          "**Forms.** Vertical form controls in drawers and dialogs, horizontal ones on wide settings pages. Errors sit under the field.",
          "",
          "**Lists.** Filter chips and search above, a List table, Pagination below; the empty state, skeleton or alert takes the table's place. See Patterns/List page.",
        ].join("\n"),
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const SpacingRhythm: Story = {
  name: "Spacing rhythm",
  render: () => (
    <DoDont
      why="The parent's gap keeps every space on the scale and lets a child move without leaving a hole."
      dont={
        <Box>
          <Heading size="sm" marginBottom="13px">
            Budget
          </Heading>
          <Text marginBottom="7px">92 percent of this period&apos;s limit is used.</Text>
          <Button size="sm" marginTop="10px">
            Raise the limit
          </Button>
        </Box>
      }
      dontCode={`<Heading marginBottom="13px"/> <Text marginBottom="7px"/> <Button marginTop="10px"/>`}
      doThis={
        <Stack gap={3} align="start">
          <Heading size="sm">Budget</Heading>
          <Text>92 percent of this period&apos;s limit is used.</Text>
          <Button size="sm">Raise the limit</Button>
        </Stack>
      }
      doCode={`<Stack gap={3}> <Heading/> <Text/> <Button/> </Stack>`}
    />
  ),
};

export const CardLayout: Story = {
  name: "Card, not a styled box",
  render: () => (
    <DoDont
      why="A Card carries the surface, border, radius and padding for both modes; a styled Box repeats them and drifts."
      dont={
        <Box bg="white" borderRadius="12px" padding="18px" boxShadow="0 1px 3px rgba(0,0,0,0.1)">
          <Text>Model providers</Text>
        </Box>
      }
      dontCode={`<Box bg="white" borderRadius="12px" padding="18px" boxShadow="0 1px 3px …">`}
      doThis={
        <Card.Root>
          <Card.Body>
            <Text>Model providers</Text>
          </Card.Body>
        </Card.Root>
      }
      doCode={`<Card.Root><Card.Body>…</Card.Body></Card.Root>`}
    />
  ),
};

export const FormLayout: Story = {
  name: "Form layout",
  render: () => (
    <DoDont
      why="The form control gives the label, helper and error one shape everywhere, and ties them to the input for screen readers."
      dont={
        <Stack gap={1}>
          <Text fontSize="13px" fontWeight="bold">
            Name
          </Text>
          <Input />
          <Text fontSize="11px" color="red.500">
            Required
          </Text>
        </Stack>
      }
      dontCode={`<Text fontSize="13px">Name</Text> <Input/> <Text color="red.500">Required</Text>`}
      doThis={
        <VerticalFormControl label="Name" invalid error="Enter a name.">
          <Input />
        </VerticalFormControl>
      }
      doCode={`<VerticalFormControl label="Name" invalid error="Enter a name."><Input/></VerticalFormControl>`}
    />
  ),
};

export const EmptyList: Story = {
  name: "An empty list",
  render: () => (
    <DoDont
      why="The one empty state says what the list is for and what to do next, the same way on every page."
      dont={
        <HStack justify="center" padding={6}>
          <Text color="gray.400">No data</Text>
        </HStack>
      }
      dontCode={`<Text color="gray.400">No data</Text>`}
      doThis={
        <NoDataInfoBlock
          title="No datasets yet"
          description="Datasets hold the examples you evaluate a prompt against."
          icon={<Database />}
        >
          <Button size="sm">Create a dataset</Button>
        </NoDataInfoBlock>
      }
      doCode={`<NoDataInfoBlock title=… description=… icon=…><Button/></NoDataInfoBlock>`}
    />
  ),
};
