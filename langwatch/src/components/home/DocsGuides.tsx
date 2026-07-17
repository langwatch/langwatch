import { Box, chakra, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import type { IconType } from "react-icons";
import {
  LuArrowUpRight,
  LuBookOpen,
  LuBot,
  LuCirclePlay,
  LuEye,
  LuRocket,
  LuScroll,
  LuSparkles,
  LuSquareCode,
  LuTerminal,
} from "react-icons/lu";
import { HomeCard } from "./HomeCard";

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

export function DocsGuides() {
  return (
    <HomeCard cursor="default" padding={4} height="full" width="full">
      <VStack align="stretch" gap={3} width="full">
        <HStack justify="space-between" align="center" gap={3} wrap="wrap">
          <HStack gap={2} align="baseline">
            <Text
              fontFamily="mono"
              fontSize="10.5px"
              letterSpacing="0.1em"
              textTransform="uppercase"
              color="fg.subtle"
            >
              The Odyssey
            </Text>
            <Text
              fontFamily="mono"
              fontSize="10.5px"
              color="fg.subtle"
              opacity={0.7}
            >
              · docs & guides
            </Text>
          </HStack>
          {/* Agent onboarding, Cloudflare-style: friendly copy, tool glyphs
              in their own small tiles. Lives here with the rest of the
              docs — the page header stays uncrowded. */}
          <chakra.a
            href="https://docs.langwatch.ai/integration/overview"
            target="_blank"
            rel="noreferrer"
            display="inline-flex"
            alignItems="center"
            gap={2}
            whiteSpace="nowrap"
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="full"
            background="bg.surface"
            paddingLeft={3}
            paddingRight="4px"
            paddingY="3px"
            transition="border-color 130ms ease, background 130ms ease"
            _hover={{
              borderColor: "border.emphasized",
              background: "bg.muted",
            }}
          >
            <chakra.span fontSize="12px" color="fg">
              Onboard your agent
            </chakra.span>
            <HStack gap="3px">
              {[
                { Glyph: LuBot, color: "fg.muted" },
                { Glyph: LuTerminal, color: "fg.muted" },
                { Glyph: LuSparkles, color: "orange.fg" },
              ].map(({ Glyph, color }, i) => (
                <Box
                  key={i}
                  boxSize="18px"
                  borderRadius="5px"
                  background="bg.muted"
                  borderWidth="1px"
                  borderColor="border.muted"
                  display="grid"
                  placeItems="center"
                  color={color}
                >
                  <Glyph size={10} />
                </Box>
              ))}
            </HStack>
          </chakra.a>
        </HStack>
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
