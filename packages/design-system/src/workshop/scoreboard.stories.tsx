import { Badge, Code, Grid, Heading, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { adoption } from "../../.storybook/adoption-data.ts";
import type { Debt } from "../../.storybook/adoption.ts";
import { StatTile, StatTileFigure } from "../components/values/stat-tile.tsx";

const DEBT: { key: keyof NonNullable<typeof adoption>["debt"]; label: string; rule: string }[] = [
  {
    key: "directChakra",
    label: "Files importing Chakra or Emotion directly",
    rule: "no-direct-chakra",
  },
  { key: "rawColour", label: "Hex or rgb() literals in browser code", rule: "no-raw-color" },
  { key: "paletteStep", label: "Palette steps named as a colour prop", rule: "no-raw-color" },
  { key: "handRolledTable", label: "Table.Root outside a List table", rule: "list-table.md" },
];

function DebtTable({ debt }: { debt: Debt }) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Body>
        {debt.worst.map(({ file, sites }) => (
          <Table.Row key={file}>
            <Table.Cell>
              <Code fontSize="xs">{file}</Code>
            </Table.Cell>
            <Table.Cell textAlign="end">{sites}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}

function Scoreboard() {
  if (!adoption) {
    return <Text color="fg.muted">The numbers are counted when the workshop is built.</Text>;
  }
  const { debt } = adoption;
  const entries = Object.entries(adoption.entries);
  const documented = entries.filter(([, entry]) => entry.story && !entry.storyMissing).length;
  const unused = entries.filter(([, entry]) => entry.files === 0).map(([subpath]) => subpath);
  const top = [...entries].toSorted((a, b) => b[1].files - a[1].files).slice(0, 12);
  return (
    <Stack gap={8}>
      <Grid templateColumns="repeat(auto-fill, minmax(14rem, 1fr))" gap={4}>
        <StatTile label="Entry points published">
          <StatTileFigure>{entries.length}</StatTileFigure>
        </StatTile>
        <StatTile
          label="Entry points with a story"
          meter={{ current: documented, max: entries.length }}
        >
          <StatTileFigure>{documented}</StatTileFigure>
        </StatTile>
        {DEBT.map(({ key, label }) => (
          <StatTile key={key} label={label} hint={`${debt[key].sites} sites`}>
            <StatTileFigure>{debt[key].files} files</StatTileFigure>
          </StatTile>
        ))}
      </Grid>

      <Stack gap={3}>
        <Heading size="md">Most adopted</Heading>
        <Table.Root size="sm" variant="line">
          <Table.Body>
            {top.map(([subpath, entry]) => (
              <Table.Row key={subpath}>
                <Table.Cell>
                  <Code fontSize="xs">@langwatch/design-system{subpath.slice(1)}</Code>
                </Table.Cell>
                <Table.Cell textAlign="end">{entry.files} files</Table.Cell>
                <Table.Cell textAlign="end">{Object.keys(entry.owners).length} packages</Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Stack>

      {DEBT.map(({ key, label, rule }) => (
        <Stack key={key} gap={2}>
          <HStack gap={2}>
            <Heading size="sm">{label}</Heading>
            <Badge variant="outline">{rule}</Badge>
          </HStack>
          <Text color="fg.muted">The files with the most, to move first.</Text>
          <DebtTable debt={debt[key]} />
        </Stack>
      ))}

      <Stack gap={2}>
        <Heading size="sm">Published but imported nowhere</Heading>
        <Text color="fg.muted">
          Candidates to retire, or to adopt where a screen hand-rolls the same thing.
        </Text>
        <HStack gap={2} flexWrap="wrap">
          {unused.map((subpath) => (
            <Code key={subpath}>{subpath}</Code>
          ))}
        </HStack>
      </Stack>
    </Stack>
  );
}

const meta = {
  title: "Consistency/Scoreboard",
  parameters: {
    usage: {
      use: "Pick the next file to move onto the design system, and see whether the counts fall release to release.",
    },
    docs: {
      description: {
        component:
          "Counted from the import sites across apps, modules, enterprise and packages each time this workshop is built (`.storybook/adoption.ts`). Run `node packages/design-system/.storybook/adoption.ts` for the raw numbers.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = { render: () => <Scoreboard /> };
