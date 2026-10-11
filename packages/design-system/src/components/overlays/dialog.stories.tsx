import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExternalLink } from "lucide-react";
import { useRef, useState } from "react";

import { Button, Input, Stack, Text } from "../../primitives.ts";
import { Checkbox } from "../forms/checkbox.tsx";
import { Dialog } from "./dialog.tsx";
import { Menu } from "./menu.tsx";

const noop = () => undefined;

const meta = {
  title: "Overlays/Dialog",
  parameters: {
    usage: {
      use: "A short, focused task or a choice that blocks the page: confirm, two choices, a small form, a secret to save, read-only details. Render `<Dialog open onClose title primaryAction>`; Cancel is drawn for you, and `secondaryAction` takes its place.",
      avoid:
        "Editing a record or a long form: use Drawer. A yes or no about a destroying act: ConfirmDialog. Assembling `Dialog.Root`/`Dialog.Content` parts (deprecated) or a `maxWidth`: pick `size`.",
    },
  },
  component: Dialog,
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: noop,
    title: "Copy dataset",
    description: "Copies every row into another project.",
    primaryAction: { label: "Copy", onClick: noop },
  },
  argTypes: { size: { control: "select", options: ["sm", "md", "lg", "xl"] } },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TwoChoices: Story = {
  args: {
    title: "Revoke shared links?",
    description: "3 links are paused. Revoking stops them for good.",
    primaryAction: { label: "Revoke 3 links", onClick: noop, danger: true },
    secondaryAction: { label: "Keep links paused", onClick: noop },
  },
};

export const FormDialog: Story = {
  args: {
    size: "md",
    title: "Push to copies",
    onSubmit: noop,
    primaryAction: { label: "Push", type: "submit" },
    children: (
      <Stack gap={3}>
        <Input aria-label="Commit message" placeholder="What changed" />
      </Stack>
    ),
  },
};

export const MustAcknowledge: Story = {
  args: {
    title: "Save your key",
    description: "This is the only time the key is shown.",
    dismissible: false,
    role: "alertdialog",
    note: <Checkbox>I've saved it</Checkbox>,
    primaryAction: { label: "Done", onClick: noop },
    children: <Text fontFamily="mono">sk-lw-••••••••••••</Text>,
  },
};

/** A once-shown secret: a click outside leaves it open; X and Escape still close it. */
export const SecretIgnoresOutsideClick: Story = {
  args: {
    title: "Your new token",
    description: "This is the only time the token is shown.",
    closeOnInteractOutside: false,
    primaryAction: { label: "Done", onClick: noop },
    children: <Text fontFamily="mono">lw-••••••••••••••••</Text>,
  },
  globals: { colorMode: "dark" },
};

/** One primary action finishes the job: no Cancel; the X and Escape still close it. */
export const PrimaryOnly: Story = {
  args: {
    title: "Token created",
    cancelLabel: null,
    primaryAction: { label: "Done", onClick: noop },
    children: <Text fontFamily="mono">lw-••••••••••••••••</Text>,
  },
  globals: { colorMode: "light" },
};

/** The card ground, for a dialog opened over a card-toned page. */
export const CardGround: Story = {
  args: { title: "Add custom model", ground: "card" },
};

export const PrimaryOnlyDark: Story = {
  ...PrimaryOnly,
  globals: { colorMode: "dark" },
};

export const ReadOnly: Story = {
  args: {
    size: "lg",
    title: "Role permissions",
    cancelLabel: "Close",
    primaryAction: undefined,
    children: <Text>{"Can view traces, datasets and evaluations. ".repeat(30)}</Text>,
  },
};

export const StepTwo: Story = {
  args: { title: "Choose a template", onBack: noop, icon: <ExternalLink size={18} /> },
};

export const Loading: Story = { args: { loading: true } };

export const Failed: Story = {
  args: { error: { title: "Couldn't load projects", onRetry: noop } },
};

export const Busy: Story = {
  args: { busy: true, primaryAction: { label: "Copy", onClick: noop, loading: true } },
};

/** The primary is a real link: a plain click closes and routes in-app; ctrl-click is native. */
export const LinkPrimary: Story = {
  args: {
    title: "You have reached the trace limit",
    description: "New traces are still collected; compare plans to raise the limit.",
    primaryAction: {
      label: "Compare plans",
      href: "/settings/subscription",
      onActivate: noop,
      onNavigate: noop,
    },
  },
};

export const LinkPrimaryBusy: Story = {
  args: {
    busy: true,
    primaryAction: { label: "Manage license", href: "/settings/license", loading: true },
  },
};

/** Three footer actions: Not now replaces Cancel; the others are outline `secondaryActions`. */
export const SecondaryActions: Story = {
  args: {
    title: "Secure your account",
    description: "Add a second step so a stolen password is not enough.",
    secondaryAction: { label: "Not now", onClick: noop },
    secondaryActions: [{ label: "Set up two-step verification", onClick: noop }],
    primaryAction: { label: "Create a passkey", onClick: noop },
  },
};

function MenuFocusDemo() {
  const [open, setOpen] = useState(false);
  const reasonRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Stack gap={3} align="start">
      <Menu.Root onSelect={() => setOpen(true)}>
        <Menu.Trigger asChild>
          <Button ref={triggerRef} variant="outline">
            Row actions
          </Button>
        </Menu.Trigger>
        <Menu.Content>
          <Menu.Item value="impersonate">Impersonate</Menu.Item>
        </Menu.Content>
      </Menu.Root>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Impersonate user"
        initialFocusEl={() => reasonRef.current}
        finalFocusEl={() => triggerRef.current}
        primaryAction={{ label: "Impersonate", onClick: () => setOpen(false) }}
      >
        <Input ref={reasonRef} aria-label="Reason" placeholder="Why do you need access?" />
      </Dialog>
    </Stack>
  );
}

/** Opened from a menu: the reason input takes focus at once; closing returns to the trigger. */
export const OpenedFromMenu: Story = { render: () => <MenuFocusDemo /> };

export const Narrow: Story = { parameters: { viewport: { defaultViewport: "mobile1" } } };

export const Closed: Story = { args: { open: false } };
