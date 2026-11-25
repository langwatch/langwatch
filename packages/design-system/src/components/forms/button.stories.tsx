import { HStack, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus } from "lucide-react";

import { Button } from "./button.tsx";

const meta = {
  title: "Inputs and forms/Button",
  parameters: {
    usage: {
      use: "Any action the reader takes. A loading button keeps its label for assistive technology.",
      avoid: "An icon alone: use IconButton with an aria-label.",
    },
  },
  component: Button,
  tags: ["autodocs"],
  args: { children: "Create dataset", colorPalette: "blue" },
  argTypes: { children: { control: "text" } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The label stays in the layout and in the accessibility tree; only the spinner shows. */
export const Loading: Story = { args: { loading: true } };

export const LoadingText: Story = { args: { loading: true, loadingText: "Creating" } };

export const WithIcon: Story = {
  args: {
    children: (
      <>
        <Plus aria-hidden /> New dataset
      </>
    ),
  },
};

export const IconLoading: Story = {
  args: {
    loading: true,
    children: (
      <>
        <Plus aria-hidden /> New dataset
      </>
    ),
  },
};

export const Disabled: Story = { args: { disabled: true } };

export const AllStates: Story = {
  render: (args) => (
    <Stack gap="3">
      {(["solid", "outline", "ghost"] as const).map((variant) => (
        <HStack key={variant} gap="3">
          <Button {...args} variant={variant} />
          <Button {...args} variant={variant} loading />
          <Button {...args} variant={variant} loading loadingText="Creating" />
          <Button {...args} variant={variant} disabled />
        </HStack>
      ))}
    </Stack>
  ),
};
