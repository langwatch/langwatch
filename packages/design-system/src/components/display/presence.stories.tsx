import { Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  PresenceAvatarStack,
  type PresenceAvatarStackProps,
  PresenceMarker,
  type PresencePeer,
} from "./presence.tsx";

const peers: PresencePeer[] = [
  {
    sessionId: "a",
    displayName: "Alice",
    color: "blue.emphasized",
    image: null,
    detail: "Alice · trace 1a2b3c4d",
  },
  {
    sessionId: "b",
    displayName: "Bob",
    color: "green.emphasized",
    image: null,
    detail: "Bob · browsing traces",
  },
  {
    sessionId: "c",
    displayName: "Cy",
    color: "purple.emphasized",
    image: null,
    detail: "Cy · conversation 9f8e7d6c",
  },
];

const meta = {
  title: "Components/Presence",
  component: PresenceAvatarStack,
  tags: ["autodocs"],
  args: { peers },
} satisfies Meta<typeof PresenceAvatarStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stack_: Story = {};

export const Overflow: Story = { args: { max: 2 } };

export const Marker: Story = {
  render: (args: PresenceAvatarStackProps) => (
    <Stack>
      <PresenceMarker peers={args.peers} tooltipSuffix="summary section" />
    </Stack>
  ),
};
