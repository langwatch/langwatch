import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { CronSchedule } from "./cron-schedule.tsx";

const meta = {
  title: "Data display/Cron schedule",
  parameters: {
    usage: {
      use: "A cron expression, said as a sentence with its timezone.",
      avoid: "Never a raw cron string on its own.",
    },
  },
  component: CronSchedule,
  tags: ["autodocs"],
  args: { cron: "*/15 * * * *", timezone: "Europe/Amsterdam" },
} satisfies Meta<typeof CronSchedule>;

export default meta;
type Story = StoryObj<typeof meta>;

export const EveryFifteenMinutes: Story = {};

export const WeeklyMonday: Story = { args: { cron: "0 9 * * 1" } };

export const Weekdays: Story = { args: { cron: "30 8 * * 1-5", timezone: "America/New_York" } };

export const Monthly: Story = { args: { cron: "0 6 1 * *", timezone: "" } };

export const Custom: Story = { args: { cron: "0 9 1-7 1,7 *" } };

export const Narrow: Story = {
  args: { cron: "30 8 * * 1-5", timezone: "America/Argentina/Buenos_Aires" },
  render: (args) => (
    <Box width="120px" borderWidth="1px" borderColor="border.muted">
      <CronSchedule {...args} />
    </Box>
  ),
};
