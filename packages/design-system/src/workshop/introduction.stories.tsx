import { Badge, Box, Code, Grid, Heading, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";

const SECTIONS: [string, string][] = [
  ["Foundations", "Tokens, colour, type, gradients and icons: the values every screen is made of."],
  ["Primitives", "Layout, text, buttons, fields and badges, re-exported from Chakra."],
  ["Inputs and forms", "Every control that takes a value, and the field layouts around them."],
  ["Data display", "Tables, values, code, people and marks."],
  ["Feedback", "Alerts, toasts, banners, empty, loading and restricted states."],
  ["Overlays", "Dialogs, drawers, popovers, menus and tooltips."],
  ["Navigation and layout", "Page, settings and section layout."],
  ["Chrome and app shell", "The frame around every page: rails and navigation."],
  ["Brand", "The marks and branded pages."],
  ["Patterns", "Whole screens put together: list, settings, drawer with a form."],
  ["Consistency", "Do and don't pairs from real code, and the scoreboard of what is left to move."],
];

function Introduction() {
  return (
    <Stack gap={8} maxWidth="56rem">
      <Stack gap={2}>
        <Heading size="2xl">The LangWatch design system</Heading>
        <Text color="fg.muted" textStyle="lg">
          Everything a screen is built from, shown the way the application mounts it. Look here
          before drawing a component: if it exists, use it; if two modules need it, it belongs here.
        </Text>
      </Stack>
      <Grid templateColumns="repeat(auto-fill, minmax(16rem, 1fr))" gap={3}>
        {SECTIONS.map(([name, what]) => (
          <Box
            key={name}
            padding={4}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            bg="bg.panel"
          >
            <Text fontWeight="semibold">{name}</Text>
            <Text color="fg.muted" textStyle="sm">
              {what}
            </Text>
          </Box>
        ))}
      </Grid>
      <Stack gap={2}>
        <Heading size="md">Using it</Heading>
        <Text>
          Import a named entry point, never a deep path:{" "}
          <Code>@langwatch/design-system/list-table</Code>. Layout and text come from{" "}
          <Code>@langwatch/design-system/primitives</Code>. Only this package imports{" "}
          <Code>@chakra-ui/react</Code>.
        </Text>
        <Text>
          Every docs page says when to use the component and when not, how many files import it
          today, and shows each state: loading, empty, error, disabled, long text and narrow. The
          toolbar switches the colour mode.
        </Text>
      </Stack>
      <Stack gap={2}>
        <Heading size="md">Adding a component</Heading>
        <Text>
          One kebab-case file in <Code>src/components/</Code>, a named subpath in{" "}
          <Code>package.json</Code>, a story beside it with a title in one of the sections above and
          a <Code>parameters.usage</Code>, and a scenario in <Code>specs/</Code>.{" "}
          <Badge variant="outline">tests/storybook-showcase.unit.test.ts</Badge> fails an entry
          point with no story.
        </Text>
      </Stack>
    </Stack>
  );
}

const meta = {
  title: "Start here/Introduction",
  parameters: { controls: { disable: true } },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = { render: () => <Introduction /> };
