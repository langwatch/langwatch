import { Box, Grid, Heading, Link, Stack, Text } from "@chakra-ui/react";
import { storyNameFromExport, toId } from "storybook/internal/csf";

type StoryModule = {
  default?: { title?: string; parameters?: { usage?: { use?: string } } };
  [story: string]: unknown;
};

/** Every story module but the workshop's own pages, read at build time: no list to keep. */
const modules = import.meta.glob<StoryModule>(["../**/*.stories.tsx", "!./**"], { eager: true });

export type Entry = { title: string; name: string; docsId: string; storyId: string; use: string };

/** The sidebar's sections in order, each with the line its cover and the introduction show. */
export const SECTIONS: { name: string; intro: string; overview: boolean }[] = [
  {
    name: "Foundations",
    intro: "Tokens, colour, type, gradients and icons: the values every screen is made of.",
    overview: false,
  },
  {
    name: "Primitives",
    intro: "Layout, text, buttons, fields and badges, re-exported from Chakra.",
    overview: true,
  },
  {
    name: "Inputs and forms",
    intro: "Every control that takes a value, and the field layouts around them.",
    overview: true,
  },
  { name: "Data display", intro: "Tables, values, code, people and marks.", overview: true },
  {
    name: "Feedback",
    intro: "Alerts, toasts, banners, empty, loading and restricted states.",
    overview: true,
  },
  { name: "Overlays", intro: "Dialogs, drawers, popovers, menus and tooltips.", overview: true },
  { name: "Navigation and layout", intro: "Page, settings and section layout.", overview: true },
  {
    name: "Chrome and app shell",
    intro: "The frame around every page: rails and navigation.",
    overview: true,
  },
  { name: "Brand", intro: "The marks and branded pages.", overview: true },
  {
    name: "Patterns",
    intro: "Whole screens put together: list, settings, drawer with a form.",
    overview: false,
  },
  {
    name: "Consistency",
    intro: "Do and don't pairs from real code, and the scoreboard of what is left to move.",
    overview: false,
  },
];

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0] ?? text;

/** The components filed under `section`, alphabetical, each with its first story and usage. */
export function entriesIn({ section }: { section: string }): Entry[] {
  return Object.values(modules)
    .flatMap((module): Entry[] => {
      const title = module.default?.title;
      if (!title?.startsWith(`${section}/`)) return [];
      const stories = Object.keys(module).filter(
        (key) => key !== "default" && key !== "__namedExportsOrder",
      );
      // The preview is the plain state when there is one, not whatever was exported first.
      const first = stories.includes("Default") ? "Default" : stories[0];
      if (!first) return [];
      return [
        {
          title,
          name: title.slice(section.length + 1),
          docsId: toId(title, "docs"),
          storyId: toId(title, storyNameFromExport(first)),
          use: firstSentence(module.default?.parameters?.usage?.use ?? ""),
        },
      ];
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The toolbar's colour mode, carried into previews and links so they match the page. */
export const withMode = ({ href, colorMode }: { href: string; colorMode?: unknown }) =>
  typeof colorMode === "string" ? `${href}&globals=colorMode:${colorMode}` : href;

/** A preview iframe: the story centred on its page (`thumb:on`), in the page's colour mode. */
const previewSrc = ({ storyId, colorMode }: { storyId: string; colorMode?: unknown }) => {
  const mode = typeof colorMode === "string" ? `;colorMode:${colorMode}` : "";
  return `iframe.html?id=${storyId}&viewMode=story&globals=thumb:on${mode}`;
};

function Card({ entry, colorMode }: { entry: Entry; colorMode?: unknown }) {
  return (
    <Link
      href={withMode({ href: `./?path=/docs/${entry.docsId}`, colorMode })}
      target="_top"
      display="flex"
      flexDirection="column"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="lg"
      overflow="hidden"
      bg="bg.panel"
      textDecoration="none"
      _hover={{ borderColor: "border.emphasized", textDecoration: "none" }}
    >
      <Box height="9rem" overflow="hidden" pointerEvents="none" aria-hidden>
        <iframe
          title={entry.name}
          src={previewSrc({ storyId: entry.storyId, colorMode })}
          loading="lazy"
          tabIndex={-1}
          style={{
            width: "150%",
            height: "150%",
            border: 0,
            transform: "scale(0.6667)",
            transformOrigin: "0 0",
          }}
        />
      </Box>
      <Stack gap={0.5} paddingX={3} paddingY={2.5} borderTopWidth="1px" borderColor="border.muted">
        <Text fontWeight="medium" textStyle="sm" color="fg">
          {entry.name}
        </Text>
        {entry.use ? (
          <Text textStyle="xs" color="fg.muted" lineClamp={2}>
            {entry.use}
          </Text>
        ) : null}
      </Stack>
    </Link>
  );
}

/** A section's cover page: what the section holds, then one card per component. */
export function SectionOverview({ section, colorMode }: { section: string; colorMode?: unknown }) {
  const entries = entriesIn({ section });
  const intro = SECTIONS.find(({ name }) => name === section)?.intro;
  return (
    <Stack gap={6} padding={8} maxWidth="72rem" marginX="auto">
      <Stack gap={1.5} maxWidth="44rem">
        <Heading size="2xl">{section}</Heading>
        <Text color="fg.muted" textStyle="md">
          {intro}
        </Text>
        <Text color="fg.subtle" textStyle="xs">
          {entries.length} components
        </Text>
      </Stack>
      <Grid templateColumns="repeat(auto-fill, minmax(15rem, 1fr))" gap={4}>
        {entries.map((entry) => (
          <Card key={entry.title} entry={entry} colorMode={colorMode} />
        ))}
      </Grid>
    </Stack>
  );
}
