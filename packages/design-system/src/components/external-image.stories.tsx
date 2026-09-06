import { Box } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExternalImage } from "./external-image.tsx";

const SAMPLE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNDAiIGhlaWdodD0iMTQwIj48cmVjdCB3aWR0aD0iMjQwIiBoZWlnaHQ9IjE0MCIgZmlsbD0iI2VkODkyNiIvPjx0ZXh0IHg9IjEyMCIgeT0iNzYiIGZvbnQtZmFtaWx5PSJzYW5zLXNlcmlmIiBmb250LXNpemU9IjE4IiBmaWxsPSIjZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5BdHRhY2htZW50PC90ZXh0Pjwvc3ZnPg==";

const meta = {
  title: "Components/External image",
  component: ExternalImage,
  tags: ["autodocs"],
  args: {
    src: SAMPLE,
    alt: "An image attached to the trace",
    maxWidth: "240px",
  },
  render: (args) => (
    <Box maxWidth="320px">
      <ExternalImage {...args} />
    </Box>
  ),
} satisfies Meta<typeof ExternalImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The address does not resolve, so the fallback stands in for the picture. */
export const Broken: Story = {
  args: { src: "https://example.invalid/missing.png" },
};

/** Clicking expands the image in place rather than opening a new tab. */
export const Expandable: Story = {
  args: { expandable: true },
};

/** Nothing is linked: the image is inert. */
export const NotLinkified: Story = {
  args: { dontLinkify: true },
};

export const NarrowWidth: Story = {
  render: (args) => (
    <Box maxWidth="90px">
      <ExternalImage {...args} maxWidth="90px" />
    </Box>
  ),
};
