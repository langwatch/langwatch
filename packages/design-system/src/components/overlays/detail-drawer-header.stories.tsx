import { Badge, Box, HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Building2, ShieldCheck } from "lucide-react";

import { DetailDrawerHeader } from "./detail-drawer-header.tsx";
import { Drawer } from "./drawer.tsx";

const meta = {
  title: "Overlays/Detail drawer header",
  component: DetailDrawerHeader,
  tags: ["autodocs"],
  parameters: {
    usage: {
      use: "Entity drawers: kind and icon above the entity name, then context and status. Place inside Drawer.Header; it supplies Drawer.Title for the accessible dialog name.",
      avoid:
        "Forms with a single action title: use Drawer.Title directly. The host owns close controls and drawer sizing.",
    },
  },
  decorators: [
    (Story) => (
      <Drawer.Root open size="lg">
        <Drawer.Content>
          <Drawer.Header paddingEnd={14}>
            <Story />
          </Drawer.Header>
          <Drawer.CloseTrigger />
          <Drawer.Body />
        </Drawer.Content>
      </Drawer.Root>
    ),
  ],
  args: {
    kind: "SSO connection",
    icon: <ShieldCheck size={14} aria-hidden />,
    title: "Acme Workforce",
    children: (
      <>
        <HStack gap={1.5} color="fg.muted" fontSize="sm">
          <Building2 size={14} />
          <Text>Acme</Text>
        </HStack>
        <Badge variant="outline">OIDC</Badge>
        <Badge colorPalette="green">
          <Box boxSize="1.5" borderRadius="full" bg="colorPalette.solid" />
          Active
        </Badge>
      </>
    ),
  },
} satisfies Meta<typeof DetailDrawerHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const LongName: Story = {
  args: { title: "Acme international workforce identity and access connection" },
};
export const WithoutMetadata: Story = { args: { children: null } };
