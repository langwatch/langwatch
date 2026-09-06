import { HStack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FieldInfoTooltip } from "./field-info-tooltip";

const meta = {
  title: "Components/Field info tooltip",
  component: FieldInfoTooltip,
  tags: ["autodocs"],
  args: {
    description: "A virtual key stands in for a provider key, so the real one never leaves us.",
  },
  argTypes: { trigger: { control: "inline-radio", options: ["click", "hover"] } },
  render: (args) => (
    <HStack gap="2">
      <Text textStyle="sm">Virtual key</Text>
      <FieldInfoTooltip {...args} />
    </HStack>
  ),
} satisfies Meta<typeof FieldInfoTooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Click the icon to open it. */
export const Default: Story = {};

export const WithDocumentationLink: Story = {
  args: { docHref: "/ai-gateway/virtual-keys", docLabel: "Read about virtual keys" },
};

/** Opens on hover, for a form with several icons close together. */
export const HoverTrigger: Story = {
  args: { trigger: "hover" },
};

export const LongText: Story = {
  args: {
    description:
      "Budgets are evaluated per period against the spend recorded by the gateway. A request that would cross the limit is refused before it reaches the provider, so a runaway agent cannot spend past the number you set here.",
    docHref: "/ai-gateway/budgets",
  },
};
