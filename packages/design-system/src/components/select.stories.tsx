import { Box, createListCollection, Stack } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./select";

const models = createListCollection({
  items: [
    { label: "gpt-5-mini", value: "gpt-5-mini" },
    { label: "claude-opus-4", value: "claude-opus-4" },
    { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
  ],
});

const empty = createListCollection<{ label: string; value: string }>({ items: [] });

const meta = {
  title: "Components/Select",
  component: Select.Root,
  tags: ["autodocs"],
  args: { collection: models },
  argTypes: { collection: { control: false } },
  render: (args) => (
    <Box maxWidth="sm">
      <Select.Root {...args}>
        <Select.Label>Model</Select.Label>
        <Select.Trigger aria-label="Model">
          <Select.ValueText placeholder="Choose a model" />
        </Select.Trigger>
        <Select.Content>
          {args.collection.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Box>
  ),
} satisfies Meta<typeof Select.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: ["gpt-5-mini"] },
};

export const Clearable: Story = {
  args: { defaultValue: ["gpt-5-mini"] },
  render: (args) => (
    <Box maxWidth="sm">
      <Select.Root {...args}>
        <Select.Trigger clearable aria-label="Model">
          <Select.ValueText placeholder="Choose a model" />
        </Select.Trigger>
        <Select.Content>
          {models.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Box>
  ),
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Invalid: Story = {
  args: { invalid: true },
};

/** No models are configured yet, so there is nothing to choose from. */
export const Empty: Story = {
  args: { collection: empty },
};

export const Sizes: Story = {
  render: (args) => (
    <Stack gap="3" maxWidth="sm">
      {(["xs", "sm", "md", "lg"] as const).map((size) => (
        <Select.Root key={size} {...args} size={size}>
          <Select.Trigger aria-label={`Model, size ${size}`}>
            <Select.ValueText placeholder="Choose a model" />
          </Select.Trigger>
          <Select.Content>
            {models.items.map((item) => (
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      ))}
    </Stack>
  ),
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="150px">
      <Select.Root {...args}>
        <Select.Trigger aria-label="Model">
          <Select.ValueText placeholder="Choose a model" />
        </Select.Trigger>
        <Select.Content>
          {models.items.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Box>
  ),
};
