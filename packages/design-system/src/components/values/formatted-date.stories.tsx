import { Temporal } from "@langwatch/time";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DateFormats, FormattedDate } from "./formatted-date.tsx";

const SAMPLE = "2026-10-08T14:32:00Z";
const SAMPLE_MS = Temporal.Instant.from(SAMPLE).epochMilliseconds;

const meta = {
  title: "Data display/Formatted date",
  parameters: {
    usage: {
      use: "Any date or time: in the viewer's zone, with UTC, the source zone and the age on hover.",
      avoid: "Never `toLocaleString` or a hand-built format at the call site.",
    },
  },
  component: FormattedDate,
  tags: ["autodocs"],
  args: { value: SAMPLE },
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
