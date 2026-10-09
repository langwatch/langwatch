import { Button } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserRound } from "lucide-react";

import { SettingsSection } from "./settings-section.tsx";

const meta = {
  title: "Components/Settings section",
  component: SettingsSection,
  tags: ["autodocs"],
  args: {
    icon: <UserRound size={18} />,
    title: "Your details",
    hint: "How you are shown wherever LangWatch names a person.",
  },
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    actions: (
      <Button size="sm" variant="outline" colorPalette="orange">
        Edit
      </Button>
    ),
  },
};
