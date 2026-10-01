import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { KeyRound, Plug, ShieldCheck } from "lucide-react";

import { SectionNavigationFrame } from "./section-navigation-frame.tsx";

const meta = {
  title: "Components/Section navigation frame",
  component: SectionNavigationFrame,
  tags: ["autodocs"],
  args: {
    label: "Authentication",
    links: [
      { label: "Overview", href: "/settings/authentication", icon: <ShieldCheck size={14} /> },
      {
        label: "Identity provider",
        href: "/settings/authentication/provider",
        icon: <KeyRound size={14} />,
      },
      {
        label: "Connectors",
        href: "/settings/authentication/connectors",
        icon: <Plug size={14} />,
      },
    ],
    activeHref: "/settings/authentication",
    onNavigate: () => {},
    children: <Text>The page this entry opens.</Text>,
  },
} satisfies Meta<typeof SectionNavigationFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A deeper entry is the current one. */
export const DeeperEntryActive: Story = {
  args: { activeHref: "/settings/authentication/provider" },
};
