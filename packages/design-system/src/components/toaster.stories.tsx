import { Button, HStack, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toaster, toaster } from "./toaster.tsx";

const meta = {
  title: "Components/Toaster",
  component: Toaster,
  tags: ["autodocs"],
  argTypes: { renderMeta: { control: false } },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One button per status: raise a toast to see it. */
export const Default: Story = {
  render: (args) => (
    <Stack gap="3" align="start">
      <Toaster {...args} />
      <HStack gap="2" wrap="wrap">
        <Button
          size="sm"
          onClick={() => toaster.create({ type: "success", title: "Prompt saved" })}
        >
          Success
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toaster.create({
              type: "error",
              title: "Could not save the prompt",
              description: "The handle is already taken.",
            })
          }
        >
          Error
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toaster.create({
              type: "warning",
              title: "The budget is nearly spent",
              description: "92 percent of this period's limit is used.",
            })
          }
        >
          Warning
        </Button>
        <Button
          size="sm"
          onClick={() => toaster.create({ type: "info", title: "Two members were invited" })}
        >
          Information
        </Button>
        <Button
          size="sm"
          onClick={() =>
            toaster.create({ type: "loading", title: "Running the evaluation", duration: 3000 })
          }
        >
          Loading
        </Button>
      </HStack>
    </Stack>
  ),
};

/** A toast that offers the one thing worth doing about it. */
export const WithAnAction: Story = {
  render: (args) => (
    <Stack gap="3" align="start">
      <Toaster {...args} />
      <Button
        size="sm"
        onClick={() =>
          toaster.create({
            type: "error",
            title: "The evaluation failed",
            description: "The provider returned too many requests.",
            action: { label: "Run it again", onClick: () => undefined },
          })
        }
      >
        Raise it
      </Button>
    </Stack>
  ),
};

/** Long copy wraps inside the toast rather than widening it. */
export const LongText: Story = {
  render: (args) => (
    <Stack gap="3" align="start">
      <Toaster {...args} />
      <Button
        size="sm"
        onClick={() =>
          toaster.create({
            type: "error",
            title: "Could not start the evaluation run",
            description:
              "The dataset column names do not match the prompt's inputs. Map them on the run parameters step and start the run again.",
            duration: 8000,
          })
        }
      >
        Raise it
      </Button>
    </Stack>
  ),
};

/** The composing application can render its own trailer under the description. */
export const WithMeta: Story = {
  render: () => (
    <Stack gap="3" align="start">
      <Toaster
        renderMeta={(meta) =>
          meta?.traceId ? (
            <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
              {String(meta.traceId)}
            </Text>
          ) : null
        }
      />
      <Button
        size="sm"
        onClick={() =>
          toaster.create({
            type: "error",
            title: "Something went wrong",
            meta: { traceId: "4b1d0f2a9c3e" },
          })
        }
      >
        Raise it
      </Button>
    </Stack>
  ),
};
