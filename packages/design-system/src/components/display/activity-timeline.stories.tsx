import { Badge, Box, Skeleton, Text } from "@chakra-ui/react";
import { nowInstant } from "@langwatch/time";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Globe, Pencil, Play, ShieldCheck, Users } from "lucide-react";

import { ActivityTimeline } from "./activity-timeline.tsx";

const now = nowInstant().epochMilliseconds;
const meta = {
  title: "Data display/Activity timeline",
  component: ActivityTimeline,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Timestamped entity history. Entries are sorted newest first and grouped by viewer-local day. Map feature event kinds to decorative icons at the call site. Times use FormattedDate with exact-time hover and keyboard focus.",
      avoid:
        "Future schedules, paginated feeds without loaded boundaries, or interactive workflow steps. The host owns data loading; pass empty entries and an emptyState for loading or errors.",
    },
  },
  args: {
    title: "History",
    entries: [
      {
        id: "claim",
        occurredAtMs: now - 172_800_000,
        content: "Claimed acme.example",
        icon: <Globe size={14} />,
      },
      {
        id: "verify",
        occurredAtMs: now - 86_400_000,
        content: "Verified the domain",
        icon: <ShieldCheck size={14} />,
        meta: <Badge size="xs">Carried over</Badge>,
      },
      {
        id: "rename",
        occurredAtMs: now - 3_600_000,
        content: "Renamed to Acme Workforce",
        icon: <Pencil size={14} />,
      },
      {
        id: "policy",
        occurredAtMs: now - 600_000,
        content: "New members need administrator approval",
        icon: <Users size={14} />,
      },
      {
        id: "active",
        occurredAtMs: now - 300_000,
        content: "Turned on the connection",
        icon: <Play size={14} />,
      },
    ],
  },
} satisfies Meta<typeof ActivityTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Empty: Story = {
  args: { entries: [], emptyState: "Nothing has happened to this connection yet." },
};
export const Loading: Story = { args: { entries: [], emptyState: <Skeleton height="16" /> } };
export const Unavailable: Story = {
  args: { entries: [], emptyState: <Text color="fg.error">History could not be loaded.</Text> },
};
export const Narrow: Story = {
  decorators: [
    (Story) => (
      <Box width="260px">
        <Story />
      </Box>
    ),
  ],
};
