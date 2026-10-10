import { Badge, Code, Grid, Heading, Link, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { toId } from "storybook/internal/csf";

import { SECTIONS, entriesIn, withMode } from "./section-overview.tsx";

/** Where a section card leads: its cover page, or the docs of its first page when it has none. */
function sectionHref({ name, overview }: { name: string; overview: boolean }): string {
  if (overview) return `./?path=/story/${toId(`${name}/Overview`, "Overview")}`;
  const first = entriesIn({ section: name })[0];
  return first ? `./?path=/docs/${first.docsId}` : "./?";
}

function Introduction({ colorMode }: { colorMode?: unknown }) {
  return (
    <Stack gap={8} maxWidth="56rem" padding={8} marginX="auto">
      <Stack gap={2}>
        <Heading size="2xl">The LangWatch design system</Heading>
        <Text color="fg.muted" textStyle="lg">
          Everything a screen is built from, shown the way the application mounts it. Look here
          before drawing a component: if it exists, use it; if two modules need it, it belongs here.
        </Text>
      </Stack>
      <Grid templateColumns="repeat(auto-fill, minmax(16rem, 1fr))" gap={3}>
        {SECTIONS.map((section) => (
          <Link
            key={section.name}
            href={withMode({ href: sectionHref(section), colorMode })}
            target="_top"
            padding={4}
            display="block"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="lg"
            bg="bg.panel"
            textDecoration="none"
            _hover={{ borderColor: "border.emphasized", textDecoration: "none" }}
          >
            <Text fontWeight="semibold" color="fg">
              {section.name}
            </Text>
            <Text color="fg.muted" textStyle="sm">
              {section.intro}
            </Text>
          </Link>
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
          Each section opens on an overview: every component in it, with a preview and when to use
          it. A component's page shows it, then its states, then its props. The toolbar switches the
          colour mode.
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
  parameters: { layout: "fullscreen", controls: { disable: true } },
  tags: ["!autodocs", "dev"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
  render: (_, { globals }) => <Introduction colorMode={globals.colorMode} />,
};
