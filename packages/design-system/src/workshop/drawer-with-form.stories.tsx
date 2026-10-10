import { Button, Input, Stack, Textarea } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Checkbox } from "../components/forms/checkbox.tsx";
import { VerticalFormControl } from "../components/forms/vertical-form-control.tsx";
import { Drawer } from "../components/overlays/drawer.tsx";

function DatasetDrawer({
  invalid = false,
  saving = false,
}: {
  invalid?: boolean;
  saving?: boolean;
}) {
  return (
    <Drawer.Root open size="md">
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <Drawer.Title>New dataset</Drawer.Title>
        </Drawer.Header>
        <Drawer.Body>
          <Stack gap={5}>
            <VerticalFormControl
              label="Name"
              invalid={invalid}
              error={invalid ? "Enter a name." : undefined}
            >
              <Input defaultValue={invalid ? "" : "Refund questions"} />
            </VerticalFormControl>
            <VerticalFormControl label="Description" helper="What the examples in it are for.">
              <Textarea />
            </VerticalFormControl>
            <Checkbox defaultChecked>Include archived traces</Checkbox>
          </Stack>
        </Drawer.Body>
        <Drawer.Footer>
          <Button variant="ghost" size="sm">
            Cancel
          </Button>
          <Button size="sm" colorPalette="accent" loading={saving}>
            Create dataset
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

const meta = {
  title: "Patterns/Drawer with form",
  parameters: {
    usage: {
      use: "Creating or editing one record beside the page: vertical form controls in the body, Cancel and the one primary action in the footer, errors under their fields.",
      avoid:
        "A dialog for a long form, a drawer opened inside another drawer, or a toast for a field error.",
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <DatasetDrawer /> };

export const Invalid: Story = { render: () => <DatasetDrawer invalid /> };

export const Saving: Story = { render: () => <DatasetDrawer saving /> };
