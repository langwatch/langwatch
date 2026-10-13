import { Card } from "@langwatch/design-system/card";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { SettingsField } from "@langwatch/design-system/settings-field";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DoDont } from "../../.storybook/do-dont.tsx";

const meta = {
  title: "Patterns/Using them together",
  parameters: {
    usage: {
      use: "Tokens set the values, primitives lay them out, components carry the behaviour. A screen is a page, then its sections, then cards or a list table, spaced on the scale. Start from a pattern below and copy it.",
      avoid:
        "Margins on children, pixel values, and a component rebuilt from primitives because it was quicker than finding it.",
    },
    docs: {
      description: {
        component: [
          "**Start from a pattern.** Each one is a runnable composition on the current shapes, with its source to copy. They show how the pieces go together on a real screen; they are not new components.",
          "",
          "| Pattern | Use it when | Built from |",
          "| --- | --- | --- |",
          "| [Create, edit and delete](?path=/docs/patterns-create-edit-and-delete--docs) | You manage a short list of records and keep the list in view | `ListPage`, `ListTable`, `Drawer`, `ConfirmDialog`, `Toaster` |",
          "| [List page](?path=/docs/patterns-list-page--docs) | You show one kind of thing with search, filters and paging | `ListPage`, `ListTable`, `FilterChips`, `Pagination` |",
          "| [Settings page](?path=/docs/patterns-settings-page--docs) | You edit durable settings | `PageLayout`, `SettingsSection`, `SettingsField` |",
          "| [Drawer with form](?path=/docs/patterns-drawer-with-form--docs) | A long edit sits beside its page | `Drawer`, `SettingsField` |",
          "| [Resource detail](?path=/docs/patterns-resource-detail--docs) | You show one thing with its facts, actions and usage | `PageLayout`, `Card`, `CodeTabs`, `ListTable`, `ConfirmDialog` |",
          "| [Data-rich overview](?path=/docs/patterns-data-rich-overview--docs) | You show figures, a trend and the records behind them | `StatTile`, `MetricTabs`, `TimeSeriesChart`, `TableToolbar`, `ListTable`, `SelectionActionBar`, `Pagination` |",
          "| [Guided setup](?path=/docs/patterns-guided-setup--docs) | A setup has stages that build on each other | `Drawer`, `Card`, `SettingsField`, `ActionRow`, `LoadMore` |",
          "| [API key create and reveal](?path=/docs/patterns-api-key-create-and-reveal--docs) | You create a credential whose secret is shown once | `Drawer`, `Dialog`, `ContentTabs`, `SnippetPreview`, `ScopeChipPicker` |",
          "| [Resource catalogue](?path=/docs/patterns-resource-catalogue--docs) | You scan a modest set of resources by name and kind | `ListPage`, `CardGrid`, `ResourceTile`, `Drawer` |",
          "| [Ops overview](?path=/docs/patterns-ops-overview--docs) | An operational list with figures and a detail drawer. Older: it is being rebuilt on the current shapes | `ListPage`, `StatTile`, `Drawer` |",
          "",
          "**Spacing rhythm.** The parent sets the gap; children carry no margins. Inside a card `gap={2}` to `gap={3}`, between cards `gap={4}`, between sections of a page `gap={8}` to `gap={10}`.",
          "",
          "**Page, section, card.** A ListPage or PageLayout gives the header and container; a Settings section gives a band its title and purpose; a Card groups the facts of one thing.",
          "",
          "**Forms.** Stacked settings fields in drawers and dialogs, inline ones on wide settings pages. Errors sit under the field.",
          "",
          "**Lists.** Search and filters in the page toolbar, a list table with one native opener per row, paging below. Loading, empty, no-results and error take the table's place, and the last three always say where to go next.",
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
          <Heading textStyle="cardTitle" marginBottom="13px">
            Budget
          </Heading>
          <Text marginBottom="7px">92 percent of this period&apos;s limit is used.</Text>
          <Button size="sm" marginTop="10px">
            Raise the limit
          </Button>
        </Box>
      }
      dontCode={`<Heading size="sm" marginBottom="13px"/> <Text marginBottom="7px"/> <Button marginTop="10px"/>`}
      doThis={
        <Stack gap={3} align="start">
          <Heading textStyle="cardTitle">Budget</Heading>
          <Text>92 percent of this period&apos;s limit is used.</Text>
          <Button size="sm">Raise the limit</Button>
        </Stack>
      }
      doCode={`<Stack gap={3}> <Heading size="sm"/> <Text/> <Button/> </Stack>`}
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
        <Card title="Model providers" description="Keys the workspace can use.">
          <Text>Two providers are connected.</Text>
        </Card>
      }
      doCode={`<Card title="Model providers" description="Keys the workspace can use.">…</Card>`}
    />
  ),
};

export const FormLayout: Story = {
  name: "Form layout",
  render: () => (
    <DoDont
      why="The settings field gives the label, hint and error one shape everywhere, and ties them to the input for screen readers."
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
        <SettingsField label="Name" error="Enter a name." layout="stacked">
          <Input />
        </SettingsField>
      }
      doCode={`<SettingsField label="Name" error="Enter a name." layout="stacked"><Input/></SettingsField>`}
    />
  ),
};

export const EmptyList: Story = {
  name: "An empty list",
  render: () => (
    <DoDont
      why="The one empty state says what the list is for and where to go next: a docs page, a setting or a prompt for a coding agent."
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
          icon={<ColumnTypeIcon type="list" size={24} />}
          next={[
            {
              kind: "docs",
              label: "Read about datasets",
              href: "https://docs.langwatch.ai/datasets/overview",
            },
          ]}
        />
      }
      doCode={`<NoDataInfoBlock title=… description=… icon=… next={[{ kind: "docs", label, href }]} />`}
    />
  ),
};
