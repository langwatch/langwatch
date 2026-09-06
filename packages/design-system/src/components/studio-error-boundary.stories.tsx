import { Box, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { StudioIsolatedErrorBoundary } from "./studio-error-boundary";

function Crashing(): never {
  throw new Error("Cannot read properties of undefined (reading 'parameters')");
}

function CrashingWithCode(): never {
  throw Object.assign(new Error("rejected"), {
    data: { error: { code: "validation_error" } },
  });
}

const meta = {
  title: "Patterns/Studio error boundary",
  component: StudioIsolatedErrorBoundary,
  tags: ["autodocs"],
  args: { scope: "Node inspector" },
  argTypes: { children: { control: false }, resetKeys: { control: false } },
  render: (args) => (
    <Box maxWidth="420px">
      <StudioIsolatedErrorBoundary {...args} />
    </Box>
  ),
} satisfies Meta<typeof StudioIsolatedErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing crashed, so the children render untouched. */
export const Default: Story = {
  args: { children: <Text>The panel renders normally.</Text> },
};

/** A production build shows the scope and the remediation, never the raw message. */
export const Crashed: Story = {
  args: { children: <Crashing /> },
};

/** A development build adds the raw message underneath. */
export const CrashedInDevelopment: Story = {
  args: { children: <Crashing />, isDevelopment: true },
};

/** A crash carrying a code is a handled failure, so the scope is not used as the heading. */
export const CrashedWithACode: Story = {
  args: { children: <CrashingWithCode /> },
};

/** No scope given: the heading falls back to the generic line. */
export const NoScope: Story = {
  args: { scope: undefined, children: <Crashing /> },
};
