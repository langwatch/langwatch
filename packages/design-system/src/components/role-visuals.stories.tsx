import type { Meta, StoryObj } from "@storybook/react-vite";

import { HStack, Text } from "../primitives.ts";
import { getDisplayRoleVisuals, type SourceRole } from "./role-visuals.tsx";

function RoleVisuals({ role, isScenario }: { role: SourceRole; isScenario: boolean }) {
  const { Icon, label } = getDisplayRoleVisuals(role, { isScenario });
  return (
    <HStack gap={2}>
      <Icon />
      <Text fontSize="sm">{label}</Text>
    </HStack>
  );
}

const meta = {
  title: "Components/Role visuals",
  component: RoleVisuals,
  tags: ["autodocs"],
  args: { role: "user", isScenario: false },
} satisfies Meta<typeof RoleVisuals>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {};

export const ScenarioAssistant: Story = {
  args: { role: "assistant", isScenario: true },
};
