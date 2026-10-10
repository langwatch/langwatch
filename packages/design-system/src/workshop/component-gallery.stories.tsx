import { Box, Grid, Heading, Link, Stack, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";

/** The sections the gallery shows; foundations and patterns have their own pages. */
const COMPONENT_SECTIONS = [
  "Primitives",
  "Inputs and forms",
  "Data display",
  "Feedback",
  "Overlays",
  "Navigation and layout",
  "Chrome and app shell",
  "Brand",
];

type IndexEntry = { id: string; title: string; type: "story" | "docs" };
type Component = { title: string; name: string; componentId: string; firstStoryId: string };

/** Storybook's own index, so a new story shows here with no list to update. */
function useComponents(): Component[] | "loading" | "unavailable" {
  const [state, setState] = useState<Component[] | "loading" | "unavailable">("loading");
  useEffect(() => {
    fetch("./index.json")
      .then((response) => response.json() as Promise<{ entries: Record<string, IndexEntry> }>)
      .then(({ entries }) => {
        const byTitle = new Map<string, Component>();
        for (const entry of Object.values(entries)) {
          if (entry.type !== "story" || byTitle.has(entry.title)) continue;
          const [section = "", name = entry.title] = entry.title.split("/");
          if (!COMPONENT_SECTIONS.includes(section)) continue;
          const componentId = entry.id.split("--")[0] ?? entry.id;
          byTitle.set(entry.title, {
            title: entry.title,
            name,
            componentId,
            firstStoryId: entry.id,
          });
        }
        setState([...byTitle.values()]);
      })
      .catch(() => setState("unavailable"));
  }, []);
  return state;
}

function Thumbnail({ component }: { component: Component }) {
  return (
    <Link
      href={`./?path=/docs/${component.componentId}--docs`}
      target="_top"
      display="block"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      overflow="hidden"
      bg="bg.panel"
      _hover={{ borderColor: "border.emphasized", textDecoration: "none" }}
    >
      <Box height="9rem" overflow="hidden" position="relative" pointerEvents="none" bg="bg">
        <iframe
          title={component.name}
          src={`iframe.html?id=${component.firstStoryId}&viewMode=story`}
          loading="lazy"
          tabIndex={-1}
          style={{
            width: "200%",
            height: "200%",
            border: 0,
            transform: "scale(0.5)",
            transformOrigin: "0 0",
          }}
        />
      </Box>
      <Text paddingX={3} paddingY={2} fontWeight="medium" textStyle="sm">
        {component.name}
      </Text>
    </Link>
  );
}

function Gallery() {
  const components = useComponents();
  if (components === "loading") return <Text color="fg.muted">Reading the catalogue</Text>;
  if (components === "unavailable") {
    return (
      <Text color="fg.muted">
        The gallery reads the workshop&apos;s index, which is only served by Storybook.
      </Text>
    );
  }
  return (
    <Stack gap={10}>
      {COMPONENT_SECTIONS.map((section) => {
        const inSection = components.filter(({ title }) => title.startsWith(`${section}/`));
        if (inSection.length === 0) return null;
        return (
          <Stack key={section} gap={3}>
            <Heading size="md">
              {section}{" "}
              <Text as="span" color="fg.muted">
                ({inSection.length})
              </Text>
            </Heading>
            <Grid templateColumns="repeat(auto-fill, minmax(14rem, 1fr))" gap={4}>
              {inSection.map((component) => (
                <Thumbnail key={component.title} component={component} />
              ))}
            </Grid>
          </Stack>
        );
      })}
    </Stack>
  );
}

const meta = {
  title: "Start here/Component gallery",
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "What we have, on one screen: every component's first story, live. Each thumbnail opens its docs page. The thumbnails load as they scroll into view.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Everything: Story = {
  render: () => (
    <Box padding={6}>
      <Gallery />
    </Box>
  ),
};
