import { Input, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FormErrorDisplay } from "./form-error-display";

const meta = {
  title: "Primitives/Form error display",
  component: FormErrorDisplay,
  tags: ["autodocs"],
  args: { error: "Enter an email address." },
  render: (args) => (
    <Stack maxWidth="sm" gap="0">
      <Input defaultValue="not an email" aria-invalid="true" />
      <FormErrorDisplay {...args} />
    </Stack>
  ),
} satisfies Meta<typeof FormErrorDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Nothing is wrong, so nothing is drawn. */
export const NoError: Story = {
  args: { error: undefined },
};

/** A react-hook-form field error, the shape a form hands straight through. */
export const FieldError: Story = {
  args: { error: { message: "This handle is already taken." } },
};

/** Several messages from one nested error object, each on its own line. */
export const SeveralMessages: Story = {
  args: {
    error: {
      name: { message: "Enter a name." },
      handle: { message: "Use lowercase letters, numbers and dashes." },
    },
  },
};

export const LongText: Story = {
  args: {
    error:
      "The dataset column names do not match the prompt's inputs. Rename the columns, or map them on the run parameters step before starting the evaluation.",
  },
};

/** Anything already rendered is passed through untouched. */
export const CustomNode: Story = {
  args: {
    error: (
      <Text fontSize="13px" color="fg.error">
        The key was revoked. Mint a new one to keep calling the gateway.
      </Text>
    ),
  },
};
