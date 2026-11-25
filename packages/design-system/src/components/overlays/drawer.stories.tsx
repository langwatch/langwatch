import type { Meta, StoryObj } from "@storybook/react-vite";
import { Copy, Database, Expand, GitBranch, Plus, Server, Trash2 } from "lucide-react";
import { useState } from "react";

import { Badge, Box, Button, IconButton, Input, Stack, Text } from "../../primitives.ts";
import { SearchInput } from "../forms/search-input.tsx";
import { NoDataInfoBlock } from "../states/no-data-info-block.tsx";
import { Drawer, DrawerGlassProvider } from "./drawer.tsx";

const noop = () => undefined;

const meta = {
  title: "Overlays/Drawer",
  parameters: {
    usage: {
      use: "Details, editing a record, pickers and multi-step forms beside the page. Render `<Drawer title onClose footer={{ primaryAction }}>`: the shape draws the header, body and footer. Drawers are routed singletons; pass `onBack` when the stack can go back. A footer draws Cancel only when it is given one; the X and Escape close either way.",
      avoid:
        "A quick yes or no: use Dialog. Assembling `Drawer.Root`/`Drawer.Content` parts (deprecated; they go in W-final). A drawer inside a drawer: navigate instead. A primary disabled before input: say why with `disabledReason`, or validate on submit.",
    },
  },
  component: Drawer,
  tags: ["autodocs"],
  args: {
    title: "Production key",
    onClose: noop,
    size: "md",
    children: <Text>The customer asked how to rotate a virtual key.</Text>,
    footer: { primaryAction: { label: "Save", onClick: noop } },
  },
  argTypes: { size: { control: "select", options: ["sm", "md", "lg", "xl", "full"] } },
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Form: Story = {
  args: {
    title: "New budget",
    onSubmit: noop,
    children: (
      <Stack gap={4}>
        <Input aria-label="Budget name" placeholder="Monthly spend" />
        <Input aria-label="Limit" placeholder="500" />
      </Stack>
    ),
    footer: {
      primaryAction: { label: "Create budget", type: "submit" },
      destructiveAction: { label: "Delete", icon: <Trash2 size={14} />, onClick: noop },
    },
  },
};

export const Picker: Story = {
  args: {
    title: "Choose an agent",
    onBack: noop,
    headerAction: { label: "New agent", icon: <Plus size={14} />, onClick: noop },
    toolbar: <SearchInput aria-label="Search agents" placeholder="Search agents" />,
    footer: undefined,
    children: <Text>Support bot · Billing triage · Release notes writer</Text>,
  },
};

export const Detail: Story = {
  args: {
    title: "eu-west-1 instance",
    eyebrow: { label: "Self-hosted instance", icon: <Server size={14} /> },
    subtitle: "Version 3.21.0, last seen 2 minutes ago",
    badges: (
      <>
        <Badge colorPalette="green">Healthy</Badge>
        <Badge>Enterprise</Badge>
      </>
    ),
    headerTools: (
      <IconButton aria-label="Copy instance id" variant="ghost" size="sm">
        <Copy />
      </IconButton>
    ),
    footer: { secondaryAction: { label: "Open logs", onClick: noop } },
  },
};

export const Editor: Story = {
  args: {
    title: "Support prompt",
    titleContent: <Input aria-label="Prompt name" defaultValue="Support prompt" size="sm" />,
    badges: <Badge>v12</Badge>,
    body: "flush",
    bodyScroll: "content",
    size: "xl",
    headerTools: (
      <IconButton aria-label="Expand" variant="ghost" size="sm">
        <Expand />
      </IconButton>
    ),
    children: (
      <Box flex={1} overflowY="auto" padding={6}>
        <Text>{"You are a helpful support agent. ".repeat(80)}</Text>
      </Box>
    ),
    footer: {
      secondaryAction: { label: "Save version", onClick: noop },
      primaryAction: { label: "Apply", onClick: noop },
    },
  },
};

export const Wizard: Story = {
  args: {
    title: "New automation",
    footer: {
      note: "Step 2 of 3",
      secondaryAction: { label: "Back", onClick: noop },
      primaryAction: { label: "Next", onClick: noop, disabledReason: "Pick a trigger first" },
    },
  },
};

export const Summary: Story = {
  args: {
    title: "Manage seats",
    footer: {
      summary: <Text textStyle="sm">12 seats · $240 a month, prorated $96 today</Text>,
      primaryAction: { label: "Done", onClick: noop },
    },
  },
};

export const Empty: Story = {
  args: {
    title: "Datasets",
    footer: undefined,
    children: (
      <NoDataInfoBlock
        size="inline"
        icon={<Database />}
        title="No datasets yet"
        description="Upload a CSV or save traces to start one."
      />
    ),
  },
};

/** A footer link: a real anchor in the outline look; a modified click leaves the drawer open. */
export const FooterLink: Story = {
  args: {
    title: "Instance",
    footer: {
      secondaryActions: [
        {
          label: "Open full page",
          href: "/ops/instances/1",
          onActivate: noop,
          onNavigate: noop,
        },
        { label: "Docs", href: "https://langwatch.ai/docs", target: "_blank" },
      ],
    },
  },
};

export const Loading: Story = { args: { loading: true } };

export const Failed: Story = {
  args: { error: { title: "Couldn't load the key", description: "Try again.", onRetry: noop } },
};

export const Busy: Story = {
  args: { busy: true, footer: { primaryAction: { label: "Save", onClick: noop, loading: true } } },
};

export const LongText: Story = {
  args: {
    title: "A drawer title long enough to wrap onto a second line in a medium drawer",
    subtitle: "A subtitle that also runs long, so the header shows how it wraps beside the X.",
  },
};

export const Narrow: Story = {
  parameters: { viewport: { defaultViewport: "mobile1" } },
  args: { size: "lg" },
};

export const Closed: Story = { args: { open: false } };

const FIELDS = Array.from({ length: 24 }, (_, index) => `Field ${index + 1}`);

/** A long form with a toolbar and a footer, so content passes beneath both bands as it scrolls. */
const longForm = {
  title: "Production key",
  subtitle: "Rotates every ninety days",
  badges: <Badge>Active</Badge>,
  toolbar: <SearchInput aria-label="Filter fields" placeholder="Filter fields" />,
  footer: {
    summary: <Text textStyle="sm">24 fields</Text>,
    cancel: { label: "Cancel", onClick: noop },
    primaryAction: { label: "Save", onClick: noop },
  },
  children: (
    <Stack gap={3}>
      {FIELDS.map((field) => (
        <Input key={field} aria-label={field} defaultValue={`${field} value`} />
      ))}
    </Stack>
  ),
} satisfies Story["args"];

const withGlass = (glass: boolean): NonNullable<Story["decorators"]> => [
  (Story) => (
    <DrawerGlassProvider value={glass}>
      <Story />
    </DrawerGlassProvider>
  ),
];

/**
 * Review pair for the glass header and footer: the same long form, solid (today) and glass
 * (the default since approval), light and dark. Scroll the body to see content pass beneath the
 * bands. `DRAWER_GLASS_DEFAULT` turns it off.
 */
export const SolidLight: Story = {
  args: longForm,
  decorators: withGlass(false),
  globals: { colorMode: "light" },
};

export const GlassLight: Story = {
  args: longForm,
  decorators: withGlass(true),
  globals: { colorMode: "light" },
};

export const SolidDark: Story = {
  args: longForm,
  decorators: withGlass(false),
  globals: { colorMode: "dark" },
};

export const GlassDark: Story = {
  args: longForm,
  decorators: withGlass(true),
  globals: { colorMode: "dark" },
};

/** A 24px source glyph stays 24px beside the title, and a long title wraps beside it. */
export const WithIcon: Story = {
  args: {
    title: "A source type with a name long enough to wrap onto a second line of the header",
    icon: <GitBranch size={24} />,
    subtitle: "Connected 4 minutes ago",
  },
  globals: { colorMode: "light" },
};

export const WithIconDark: Story = { ...WithIcon, globals: { colorMode: "dark" } };

/** At 320px: the glyph keeps its size, the title and subtitle wrap beside it. */
export const WithIconNarrow: Story = {
  ...WithIcon,
  parameters: { viewport: { defaultViewport: "mobile1" } },
};

/** The Back arrow carries a test id of its own when the drawer's id would not name it. */
export const WithBackTestId: Story = {
  args: {
    title: "Connect from code",
    onBack: noop,
    backButtonTestId: "back-button",
    footer: { cancel: { label: "Cancel", onClick: noop, "data-testid": "widget-cancel" } },
  },
};

function FocusReturnDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap={3} align="start">
      <Button onClick={() => setOpen(true)}>Edit key</Button>
      <Text textStyle="sm">Close the drawer: focus goes back to Edit key.</Text>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Production key"
        footer={{ primaryAction: { label: "Save", onClick: () => setOpen(false) } }}
      >
        <Input aria-label="Name" defaultValue="prod-openai" />
      </Drawer>
    </Stack>
  );
}

/** A closing drawer hands focus back to the control that opened it, or to `finalFocusEl`. */
export const ReturnsFocus: Story = { render: () => <FocusReturnDemo /> };

export const PrimaryTones: Story = {
  args: {
    title: "Evaluator",
    footer: {
      secondaryAction: { label: "Save", onClick: noop, tone: "success" },
      primaryAction: { label: "Apply", onClick: noop },
    },
  },
};

export const DetailWidth: Story = { args: { size: "detail", title: "Case" } };

/** The node owns its controls; pass the same busy flag to them as to the drawer. */
export const CustomFooter: Story = {
  args: {
    title: "Edit scenario",
    footer: undefined,
    footerContent: (
      <Stack direction="row" gap={2} flexWrap="wrap" width="full" justify="flex-end">
        <Button variant="outline" onClick={noop}>
          History
        </Button>
        <Button onClick={noop}>Save and run</Button>
      </Stack>
    ),
  },
};

export const WideContentDrawer: Story = {
  args: {
    title: "Run",
    size: "wide",
    chrome: "content",
    headerContent: <Text padding={4}>Run header band</Text>,
    children: <Text padding={4}>Transcript</Text>,
  },
};

export const StudioHeaderInset: Story = {
  args: { title: "Properties", topInset: "studio-header" },
};

export const WorkspaceRaisedFooter: Story = {
  render: () => (
    <Drawer
      onClose={() => undefined}
      title="Add records"
      size="workspace"
      footerAppearance="raised"
      preventScroll
      closeOnEscape={() => true}
      footerContent={<Button>Add records</Button>}
    >
      <Box height="1600px">Wide mapping content</Box>
    </Drawer>
  ),
};
