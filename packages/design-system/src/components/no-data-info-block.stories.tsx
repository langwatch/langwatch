import { Box, Button, Link } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Database } from "lucide-react";
import { NoDataInfoBlock } from "./no-data-info-block.tsx";

const meta = {
  title: "Components/No data info block",
  component: NoDataInfoBlock,
  tags: ["autodocs"],
  args: {
    title: "No datasets yet",
    description: "Datasets hold the examples you evaluate a prompt against.",
    icon: <Database />,
  },
  argTypes: {
    icon: { control: false },
    docsInfo: { control: false },
    children: { control: false },
  },
} satisfies Meta<typeof NoDataInfoBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    children: <Button size="sm">Create a dataset</Button>,
  },
};

export const WithDocumentationLink: Story = {
  args: {
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
