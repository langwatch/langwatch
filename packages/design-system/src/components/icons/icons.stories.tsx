import { Box, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  AnthropicIcon,
  AWSIcon,
  CustomIcon,
  DatabricksIcon,
  EqualsIcon,
  GitHubIcon,
  IconGlyph,
  LLMIcon,
  MicrosoftIcon,
  OpenAIIcon,
  OpenTelemetryIcon,
  WeaviateIcon,
  WorkatoIcon,
} from "./index.ts";

/**
 * The vendor marks, all drawn through `IconGlyph` so they sit at one size and
 * the monochrome ones stay readable on a dark surface.
 */
const MARKS = [
  { name: "Anthropic", icon: <AnthropicIcon />, monochrome: true },
  { name: "Amazon Web Services", icon: <AWSIcon />, monochrome: false },
  { name: "Custom", icon: <CustomIcon />, monochrome: true },
  { name: "Databricks", icon: <DatabricksIcon />, monochrome: false },
  { name: "Equals", icon: <EqualsIcon />, monochrome: true },
  { name: "GitHub", icon: <GitHubIcon />, monochrome: true },
  { name: "Large language model", icon: <LLMIcon />, monochrome: false },
  { name: "Microsoft", icon: <MicrosoftIcon />, monochrome: false },
  { name: "OpenAI", icon: <OpenAIIcon />, monochrome: true },
  { name: "OpenTelemetry", icon: <OpenTelemetryIcon />, monochrome: false },
  { name: "Weaviate", icon: <WeaviateIcon />, monochrome: false },
  { name: "Workato", icon: <WorkatoIcon />, monochrome: false },
];

const meta = {
  title: "Foundations/Icons",
  component: IconGlyph,
  tags: ["autodocs"],
  args: { icon: <OpenAIIcon />, monochrome: true, size: "16px" },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof IconGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllMarks: Story = {
  render: (args) => (
    <SimpleGrid columns={{ base: 2, md: 4 }} gap="4">
      {MARKS.map((mark) => (
        <Stack key={mark.name} gap="1" align="center">
          <IconGlyph icon={mark.icon} monochrome={mark.monochrome} size={args.size} />
          <Text textStyle="xs" color="fg.muted" textAlign="center">
            {mark.name}
          </Text>
        </Stack>
      ))}
    </SimpleGrid>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <Stack direction="row" gap="4" align="center">
      <IconGlyph {...args} size="12px" />
      <IconGlyph {...args} size="16px" />
      <IconGlyph {...args} size="24px" />
      <IconGlyph {...args} size="40px" />
    </Stack>
  ),
};

/**
 * A monochrome mark is inverted on the dark theme; a brand-coloured mark is
 * left alone. Switch the colour mode in the toolbar to see the difference.
 */
export const MonochromeVersusBrandColoured: Story = {
  render: (args) => (
    <Stack direction="row" gap="6">
      <Box>
        <IconGlyph icon={<OpenAIIcon />} monochrome size={args.size} />
        <Text textStyle="xs" color="fg.muted">
          monochrome
        </Text>
      </Box>
      <Box>
        <IconGlyph icon={<DatabricksIcon />} size={args.size} />
        <Text textStyle="xs" color="fg.muted">
          brand coloured
        </Text>
      </Box>
    </Stack>
  ),
};
