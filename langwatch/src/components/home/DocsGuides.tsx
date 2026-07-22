import { Box, chakra, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  LuArrowUpRight,
  LuBookOpen,
  LuCirclePlay,
  LuEye,
  LuRocket,
  LuScroll,
  LuSquareCode,
} from "react-icons/lu";
import { HomeCard } from "./HomeCard";
import {
  HOME_SECTION_GAP,
  HOME_SECTION_PADDING,
  HomeSectionHeader,
} from "./HomeSectionHeader";
import { OnboardAgentPill } from "./OnboardAgentPill";

/**
 * Docs & guides, said out loud: a card of four first-class guide links (not
 * footer whispers). Each tile names a JOB, not a document, wearing its own
 * colour — the one place on the home where the features' brand colours are
 * allowed out, because wayfinding is exactly what they're for. All real docs
 * URLs already linked elsewhere in the app, so none of them can 404.
 */

interface Guide {
  icon: IconType;
  /** Chakra colour family for the icon tile ("purple", "orange", …). */
  family: string;
  title: string;
  blurb: string;
  href: string;
}

// Titles stay FUNCTIONAL (you can find what you need at a glance); the
// odyssey lives in the blurbs, where flavour can't cost anyone wayfinding.
const GUIDES: Guide[] = [
  {
    icon: LuRocket,
    family: "orange",
    title: "Quickstart",
    blurb: "Set sail — send your first trace",
    href: "https://docs.langwatch.ai/integration/overview",
  },
  {
    icon: LuSquareCode,
    family: "blue",
    title: "SDK guides",
    blurb: "Chart the course — Python & TypeScript",
    href: "https://docs.langwatch.ai/integration/python/guide",
  },
  {
    icon: LuEye,
    family: "purple",
    title: "Evaluations",
    blurb: "Face the Cyclops — judge every answer",
    href: "https://docs.langwatch.ai/evaluations/online-evaluation/overview",
  },
  {
    icon: LuBookOpen,
    family: "green",
    title: "Datasets",
    blurb: "Stock the ship — sets from real traffic",
    href: "https://docs.langwatch.ai/datasets/overview",
  },
  {
    icon: LuCirclePlay,
    family: "red",
    title: "Videos",
    blurb: "Hear the Sirens — watch and learn",
    href: "https://www.youtube.com/@LangWatch/videos",
  },
  {
    icon: LuScroll,
    family: "teal",
    title: "All docs",
    blurb: "The full epic, unabridged",
    href: "https://docs.langwatch.ai",
  },
];

export function DocsGuides({
  showOnboardPill = true,
}: {
  /**
   * The Langy home moves the onboarding pill up into its lit block, so it
   * turns this one off rather than showing the same route twice on one page.
   */
  showOnboardPill?: boolean;
} = {}) {
  return (
    <HomeCard
      cursor="default"
      padding={HOME_SECTION_PADDING}
      height="full"
      width="full"
    >
      <VStack align="stretch" gap={HOME_SECTION_GAP} width="full">
        {/* "The Odyssey" was an internal name for this card, and a reader
            meeting it on their first day learns nothing from it. The title now
            says what the section is (copywriting.md: no internal codenames). */}
        <HomeSectionHeader title="Docs and guides">
          {showOnboardPill ? <OnboardAgentPill /> : null}
        </HomeSectionHeader>
        <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={1}>
          {GUIDES.map((guide) => (
            <GuideTile key={guide.title} guide={guide} />
          ))}
        </Grid>
      </VStack>
    </HomeCard>
  );
}

function GuideTile({ guide }: { guide: Guide }) {
  const Icon = guide.icon;
  return (
    <HStack
      as="a"
      // @ts-expect-error Chakra's `as` prop loses the anchor attributes.
      href={guide.href}
      target="_blank"
      rel="noreferrer"
      gap={2.5}
      align="center"
      paddingX={2.5}
      paddingY={2}
      borderRadius="10px"
      cursor="pointer"
      transition="background 130ms ease"
      _hover={{ background: "bg.muted" }}
      css={{
        "&:hover .guide-arrow": { opacity: 1, transform: "translate(0, 0)" },
      }}
    >
      {/* Colour lives in the icon's STROKE only — the tile stays neutral, so
          the row reads calm until the glyph's line catches the eye. */}
      <Box
        flexShrink={0}
        padding={1.5}
        borderRadius="md"
        background="bg.muted"
        color={`${guide.family}.solid`}
        display="grid"
        placeItems="center"
      >
        <Icon size={14} />
      </Box>
      <VStack align="start" gap={0} flex={1} minWidth={0}>
        <Text fontSize="13px" color="fg" lineHeight="1.3">
          {guide.title}
        </Text>
        <Text fontSize="11.5px" color="fg.muted" lineClamp={1}>
          {guide.blurb}
        </Text>
      </VStack>
      <Box
        className="guide-arrow"
        color="fg.subtle"
        opacity={0}
        transform="translate(-2px, 2px)"
        transition="opacity 130ms ease, transform 130ms ease"
        aria-hidden
      >
        <LuArrowUpRight size={14} />
      </Box>
    </HStack>
  );
}
