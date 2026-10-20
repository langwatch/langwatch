import { Box, Button, Link } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Database } from "lucide-react";

import {
  NoDataInfoBlock,
  type NoDataInfoBlockBlockProps,
  type EmptyNextStep,
} from "./no-data-info-block.tsx";

/** The block sizes, so the stories' args stay typed; `Line` renders the line size itself. */
function NoDataInfoBlockSized(props: NoDataInfoBlockBlockProps) {
  return <NoDataInfoBlock {...props} />;
}

const meta = {
  title: "Feedback/Empty state",
  parameters: {
    usage: {
      use: 'The one empty state: nothing here yet, and what to do next. size="page" fills a list page; size="inline" sits in a settings band or a table body (it replaced SettingsEmptyState). It owns its height and centres itself. At most one primaryAction; none when the page header already shows that primary. Docs via docsHref.',
      avoid:
        "Wrapping it in Center or padding it; two solid buttons; children or docsInfo in new code. Still loading: Skeleton rows. A failure: Banner. A chart with no data: Chart empty state.",
    },
  },
  component: NoDataInfoBlockSized,
  tags: ["autodocs"],
  args: {
    title: "No datasets yet",
    description: "Datasets hold the examples you evaluate a prompt against.",
    icon: <Database />,
  },
  argTypes: {
    icon: { control: false },
    size: { control: "inline-radio", options: ["page", "inline"] },
    primaryAction: { control: false },
    secondaryAction: { control: false },
    docsInfo: { control: false },
    children: { control: false },
  },
} satisfies Meta<typeof NoDataInfoBlockSized>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    primaryAction: <Button size="sm">Create a dataset</Button>,
    secondaryAction: (
      <Button size="sm" variant="ghost">
        Import a CSV
      </Button>
    ),
  },
};

export const WithDocumentationLink: Story = {
  args: { docsHref: "https://langwatch.ai/docs/datasets/overview" },
};

/** Inside a settings band or under a table header. */
export const Inline: Story = {
  args: {
    size: "inline",
    primaryAction: <Button size="sm">Add a passkey</Button>,
    title: "No passkeys yet",
    description: "Sign in with your fingerprint, face or a security key.",
  },
};

/** The old props still render; new code passes primaryAction and docsHref instead. */
export const LegacyChildren: Story = {
  args: {
    children: <Button size="sm">Create a dataset</Button>,
    docsInfo: <Link href="https://langwatch.ai/docs">Read the documentation</Link>,
  },
};

export const LongText: Story = {
  args: {
    title: "There is nothing to show for the filters you selected",
    description:
      "Every trace in this project falls outside the time range, the model and the evaluation status you picked. Widen any one of them and the list fills again.",
  },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="260px" borderWidth="1px" borderColor="border.muted" borderRadius="md">
      <NoDataInfoBlock {...args} />
    </Box>
  ),
};

export const Line: Story = {
  render: () => (
    <NoDataInfoBlock
      size="line"
      title="No replicas found."
      action={{ label: "Clear filters", onClick: () => undefined }}
    />
  ),
};

const settingNext: EmptyNextStep = {
  kind: "setting",
  label: "Open passkey settings",
  href: "/settings/security",
};
const docsNext: EmptyNextStep = {
  kind: "docs",
  label: "Read about passkeys",
  href: "https://langwatch.ai/docs",
};
const promptNext: EmptyNextStep = {
  kind: "agent-prompt",
  prompt: "Add passkey sign-in to this project.",
};

export const NextSetting: Story = { args: { next: [settingNext] } };
export const NextDocs: Story = { args: { next: [docsNext] } };
export const NextAgentPrompt: Story = { args: { next: [promptNext] } };
/** More than one way forward sit side by side; the callback action stays a separate button. */
export const NextSeveral: Story = {
  args: {
    next: [settingNext, docsNext, promptNext],
    primaryAction: <Button size="sm">Add a passkey</Button>,
  },
};

export const LineNextSetting: Story = {
  render: () => <NoDataInfoBlock size="line" title="No passkeys yet." next={[settingNext]} />,
};
export const LineNextDocs: Story = {
  render: () => <NoDataInfoBlock size="line" title="No passkeys yet." next={[docsNext]} />,
};
export const LineNextAgentPrompt: Story = {
  render: () => <NoDataInfoBlock size="line" title="No passkeys yet." next={[promptNext]} />,
};
/** A line with a callback action beside its required next step. */
export const LineNextWithAction: Story = {
  render: () => (
    <NoDataInfoBlock
      size="line"
      title="No passkeys match."
      action={{ label: "Clear filters", onClick: () => undefined }}
      next={[docsNext]}
    />
  ),
};
