import { Badge, Box, Code, Heading, HStack, Stack, Stat, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DoDont } from "../../.storybook/do-dont.tsx";
import { ListTable } from "../components/layout/list-table.tsx";
import { StatTile, StatTileFigure } from "../components/values/stat-tile.tsx";

/**
 * Each pair below is drawn from code in the tree today; the file it came from is
 * named under it. The rule column says what enforces it now, and what is ruled
 * but not yet a lint rule.
 */
const meta = {
  title: "Consistency/Do and don't",
  parameters: {
    usage: {
      use: "Before writing a screen, and in review: each pair names the shared way and the rule behind it.",
    },
    docs: {
      description: {
        component: [
          "| Rule | Says | Enforced by |",
          "| --- | --- | --- |",
          "| `no-direct-chakra` | Only `packages/design-system` imports `@chakra-ui/*` or `@emotion/*`. | Ruled (ARCHITECTURE.md §2, §10.2), not yet in `packages/oxlint-rules`: review, and the Scoreboard count. |",
          "| `no-raw-color` | No hex, `rgb()`, palette step or bare white or black outside the design system. | Ruled (ARCHITECTURE.md §2), not yet a lint rule: review, and the Scoreboard count. |",
          "| `list-table.md` | Every list of rows is a List table. | Review; the Scoreboard counts hand-rolled tables. |",
          "| `alerts-toasts-and-field-errors.md` | Field error, alert or toast, by how long it stays true. | `tests/no-raw-error-toasts.unit.test.ts` in this package. |",
        ].join("\n"),
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const TokensNotLiterals: Story = {
  name: "Tokens, not literals",
  render: () => (
    <DoDont
      why="A literal stays one colour in both modes and drifts from the palette. A semantic token follows the mode and the theme. From modules/organization/browser/src/ui/sections/organization/teams.screen.tsx."
      dont={
        <Text fontSize="sm" color="gray.500">
          3 members
        </Text>
      }
      dontCode={`<Text fontSize="sm" color="gray.500">`}
      doThis={
        <Text textStyle="sm" color="fg.muted">
          3 members
        </Text>
      }
      doCode={`<Text textStyle="sm" color="fg.muted">`}
    />
  ),
};

export const NoHex: Story = {
  name: "No hex at the call site",
  render: () => (
    <DoDont
      why="Hex values in a module are a second palette nobody reviews. A colour need the tokens lack is a new semantic token in this package. From modules/project/browser/src/ui/sections/home/components/home-page-banners.tsx."
      dont={
        <HStack gap={2}>
          {["#f56b1a", "#ffb380", "#6e57d2"].map((hex) => (
            <Box key={hex} boxSize={8} borderRadius="sm" style={{ background: hex }} />
          ))}
        </HStack>
      }
      dontCode={`const LANTERN_COLORS = ["#f56b1a", "#ffb380", "#6e57d2"];`}
      doThis={
        <HStack gap={2}>
          {["accent.solid", "accent.muted", "purple.solid"].map((token) => (
            <Box key={token} boxSize={8} borderRadius="sm" bg={token} />
          ))}
        </HStack>
      }
      doCode={`bg="accent.solid" · bg="accent.muted" · bg="purple.solid"`}
    />
  ),
};

export const DesignSystemNotChakra: Story = {
  name: "The design system, not raw Chakra",
  render: () => (
    <DoDont
      why="A module that imports Chakra builds its own copy of something the design system already has, and the two drift. From modules/ops/browser/src/features/event-store/ui/elements/redis-stat-tile.tsx."
      dont={
        <Stat.Root borderWidth="1px" borderRadius="md" padding={3}>
          <Stat.Label>Redis</Stat.Label>
          <Stat.ValueText>412 MB</Stat.ValueText>
        </Stat.Root>
      }
      dontCode={`import { Stat } from "@chakra-ui/react";\n<Stat.Root …><Stat.Label>Redis</Stat.Label>`}
      doThis={
        <StatTile label="Redis" hint="of 1 GB" meter={{ current: 412, max: 1024 }}>
          <StatTileFigure>412 MB</StatTileFigure>
        </StatTile>
      }
      doCode={`import { StatTile, StatTileFigure } from "@langwatch/design-system/stat-tile";`}
    />
  ),
};

const ROWS = [
  ["Nightly regression", "Daily at 02:00", "12"],
  ["Weekly digest", "Mondays at 09:00", "4"],
];

export const ListTableNotHandRolled: Story = {
  name: "List table, not a hand-rolled table",
  render: () => (
    <DoDont
      why="A bare table on a list page loses the shared border, header height and grid lines (list-table.md). From modules/automation/browser/src/ui/sections/automations-screen.tsx."
      dont={
        <Table.Root variant="line" size="sm">
          <Table.Body>
            {ROWS.map(([name, schedule, sends]) => (
              <Table.Row key={name}>
                <Table.Cell>{name}</Table.Cell>
                <Table.Cell>{schedule}</Table.Cell>
                <Table.Cell>{sends}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      }
      dontCode={`<Table.Root variant="line" width="full">`}
      doThis={
        <ListTable>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Name</Table.ColumnHeader>
              <Table.ColumnHeader>Schedule</Table.ColumnHeader>
              <Table.ColumnHeader>Sends</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {ROWS.map(([name, schedule, sends]) => (
              <Table.Row key={name}>
                <Table.Cell>{name}</Table.Cell>
                <Table.Cell>{schedule}</Table.Cell>
                <Table.Cell>{sends}</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </ListTable>
      }
      doCode={`import { ListTable } from "@langwatch/design-system/list-table";\n<ListTable>…Table parts…</ListTable>`}
    />
  ),
};

export const RulesSummary: Story = {
  name: "Where each rule lives",
  render: () => (
    <Stack gap={3}>
      <Heading size="sm">Read these before a screen</Heading>
      {[
        "dev/docs/best_practices/list-table.md",
        "dev/docs/best_practices/alerts-toasts-and-field-errors.md",
        "dev/docs/best_practices/scope-selector-and-badges.md",
        "dev/docs/best_practices/row-actions-overflow-menu.md",
        "dev/docs/best_practices/selection-action-bar.md",
        "dev/docs/best_practices/copywriting.md",
      ].map((doc) => (
        <HStack key={doc} gap={2}>
          <Badge variant="outline">doc</Badge>
          <Code>{doc}</Code>
        </HStack>
      ))}
    </Stack>
  ),
};
