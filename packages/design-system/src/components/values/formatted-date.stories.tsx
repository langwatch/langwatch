import { Stack, Table, Text } from "@chakra-ui/react";
import { Temporal, nowInstant } from "@langwatch/time";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DateFormats, FormattedDate } from "./formatted-date.tsx";

const SAMPLE = "2026-10-08T14:32:00Z";
const SAMPLE_MS = Temporal.Instant.from(SAMPLE).epochMilliseconds;

const meta = {
  title: "Data display/Formatted date",
  parameters: {
    usage: {
      use: "Any date or time: in the viewer's zone, as a date, a time, both, a live relative age, or `auto` for lists. The hover lists the age, every zone, ISO and Unix, each copied on click.",
      avoid: "Never `toLocaleString` or a hand-built format at the call site.",
    },
  },
  component: FormattedDate,
  tags: ["autodocs"],
  args: { value: SAMPLE },
  argTypes: {
    display: { control: "inline-radio", options: ["datetime", "date", "time", "relative", "auto"] },
  },
} satisfies Meta<typeof FormattedDate>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FromEpochMilliseconds: Story = { args: { value: SAMPLE_MS } };

export const WithSourceZone: Story = { args: { sourceTimeZone: "America/New_York" } };

export const CustomLabel: Story = { args: { children: "2 days ago" } };

/** An unreadable value draws a dash rather than "Invalid Date". */
export const Unreadable: Story = { args: { value: "not a date" } };

/** What the hover shows. */
export const Formats: Story = {
  render: () => <DateFormats epochMs={SAMPLE_MS} sourceTimeZone="Europe/Amsterdam" />,
};

const minutesAgo = (minutes: number) => nowInstant().epochMilliseconds - minutes * 60_000;

/** A relative label keeps itself current: seconds while fresh, then minutes. */
export const Relative: Story = { args: { value: minutesAgo(0.2), display: "relative" } };

/** Every display, side by side, for the same instant. */
export const Displays: Story = {
  render: () => (
    <Table.Root size="sm" width="420px">
      <Table.Body>
        {(["datetime", "date", "time", "relative", "auto"] as const).map((display) => (
          <Table.Row key={display}>
            <Table.Cell width="100px">
              <Text textStyle="xs">{display}</Text>
            </Table.Cell>
            <Table.Cell>
              <FormattedDate value={SAMPLE} display={display} />
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  ),
};

/** `auto` in a list: the time today, the day this year, the full date before that. */
export const AutoInAList: Story = {
  render: () => (
    <Stack gap="1" align="start">
      {[5, 90, 60 * 30, 60 * 24 * 40, 60 * 24 * 500].map((minutes) => (
        <FormattedDate key={minutes} value={minutesAgo(minutes)} display="auto" />
      ))}
    </Stack>
  ),
};

/** Drawn in another zone with its name, for a schedule read across zones. */
export const InAnotherZone: Story = {
  args: { timeZone: "America/New_York", showZone: true },
};
