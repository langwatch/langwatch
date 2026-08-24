import { Box, Flex, Text } from "@chakra-ui/react";
import { Fragment } from "react";

import { MONO_FONT } from "../frontDoorTheme";

/**
 * What sits under the pitch: the stack somebody's agent is already built on.
 *
 * ── Not customer logos ──────────────────────────────────────────────────────
 * A "trusted by" row is the usual furniture here and it is the one piece that
 * cannot be written by us — every mark on it is somebody else's decision to be
 * named, and putting one up without that is a claim we have not earned. Swap
 * this for real customer marks the day there is a cleared list.
 *
 * ── And not third-party logos either, which is what this WAS ────────────────
 * It held five vendor glyphs at 20px and 55% opacity. Three problems, and only
 * the first one is taste:
 *
 *   1. Every mark in `~/components/icons` is a SQUARE GLYPH — 24x24, 32x32,
 *      75x75, 512x512 — and not one is a wordmark. A logo cloud works because
 *      the reader recognises the marks; anonymous glyphs at 20px, held at 55%
 *      opacity, are five smudges. The row asked them to carry meaning they
 *      cannot carry at that size, so it communicated nothing it claimed to.
 *   2. `Anthropic` and `OpenTelemetry` hardcode `fill="#181818"`, and `OpenAI`
 *      sets no fill at all so it paints SVG-default black. Against the dark
 *      ground (#0a0a0c) three of the five were invisible: half the row did not
 *      exist for anybody in dark mode.
 *   3. `LangChainParrot` is the emoji 🦜 in an SVG `<text>` node, so it renders
 *      full-colour in the system emoji face and ignores `color` entirely — one
 *      bright cartoon bird in a row of monochrome marks.
 *
 * Those icons are shared with the rest of the app, so they are not this
 * screen's to repaint. What this screen can do is stop depending on them.
 *
 * ── Why names, and why in a grid ────────────────────────────────────────────
 * A name is a fact we are entitled to state; a logo is borrowed authority, and
 * it costs the reader a guess they routinely get wrong. Set as type it is
 * legible at a glance, it takes its colour from the ground so both modes work
 * for free, and a screen reader gets it without a parallel `aria-label` to
 * keep in sync — the old row was `aria-hidden` under a label that promised a
 * list and then delivered silence.
 *
 * But a flat run of names is a tag cloud: nine words at one weight, one size
 * and one colour is a list of things rather than a claim, and there is nowhere
 * for the eye to land. So they are GROUPED, by the three kinds of thing
 * `docs/integration/overview.mdx` groups them by, and the grouping is the
 * point — covering models is table stakes, covering models AND the framework
 * on top AND the tracing underneath is the actual claim, and the shape says it
 * before a single name is read.
 *
 * The spine between the labels and the names is what makes it one object
 * rather than three rows. It is also the only picture of the product this
 * panel draws: several kinds of thing on the left, one line they all arrive
 * at, LangWatch on the other side of it.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */

/**
 * The docs' own three sections, in the order somebody meets them: the model
 * they call, the framework they call it through, and what carries the trace.
 * Four apiece — enough that each row reads as "and so on", short enough to
 * hold one line at the width this panel actually gets.
 */
const GROUPS = [
  { label: "Models", names: ["OpenAI", "Anthropic", "Gemini", "AWS Bedrock"] },
  {
    label: "Frameworks",
    names: ["LangChain", "LangGraph", "Vercel AI SDK", "CrewAI"],
  },
  { label: "SDKs", names: ["Python", "TypeScript", "Go", "OpenTelemetry"] },
] as const;

/**
 * Deliberately under the true figure. `docs/integration/overview.mdx` lists 40
 * cards, of which 33 are somebody else's product; "30+" stays true the day one
 * of them is dropped, and a floor cannot go stale upwards. This page is read
 * by people who have not signed in, so the claim on it gets the safe number.
 */
const INTEGRATION_COUNT = "30+";

/** Rendered once per page, so a constant id is safe to label the grid with. */
const LABEL_ID = "front-door-integrations-label";

/**
 * The rule that finishes the eyebrow's line. It carries the one touch of brand
 * on this strip — a lead-in of `detail` before it settles to a hairline — and
 * it dissolves at the far edge rather than stopping dead, which is what the
 * ground behind it already does.
 */
const RULE = [
  "linear-gradient(to right,",
  "var(--chakra-colors-front-door-detail),",
  "var(--chakra-colors-front-door-hairline) 10%,",
  "var(--chakra-colors-front-door-hairline) 64%,",
  "transparent)",
].join(" ");

/**
 * The spine. It fades at both ends for the same reason the rule does: a
 * hairline that stops dead reads as the edge of a box, and there is no box.
 */
const SPINE = [
  "linear-gradient(to bottom,",
  "transparent,",
  "var(--chakra-colors-front-door-hairline) 14%,",
  "var(--chakra-colors-front-door-hairline) 86%,",
  "transparent)",
].join(" ");

export function TrustyStrippers() {
  return (
    <Flex
      direction="column"
      align={{ base: "center", md: "flex-start" }}
      gap={4}
      width="full"
    >
      <CountRule />
      <Box
        display="grid"
        // The spine lives in its own 1px column so neither text column has to
        // know it is there, and it spans every row as ONE element — segmented
        // per row, the row gaps would show as gaps in the line.
        gridTemplateColumns="auto 1px 1fr"
        columnGap="14px"
        rowGap="9px"
        width="full"
        aria-labelledby={LABEL_ID}
        data-testid="front-door-integrations"
      >
        <Box
          aria-hidden
          gridColumn={2}
          gridRow={`1 / ${GROUPS.length + 1}`}
          backgroundImage={SPINE}
        />
        {GROUPS.map(({ label, names }, index) => (
          <IntegrationRow
            key={label}
            label={label}
            names={names}
            row={index + 1}
          />
        ))}
      </Box>
    </Flex>
  );
}

/** The claim, and the rule that finishes its line. */
function CountRule() {
  return (
    <Flex align="center" gap={3} width="full">
      <Text
        id={LABEL_ID}
        flexShrink={0}
        fontFamily={MONO_FONT}
        fontSize="11px"
        letterSpacing="0.08em"
        textTransform="uppercase"
        color="fg.subtle"
        data-testid="front-door-integrations-label"
      >
        Works with {INTEGRATION_COUNT} integrations
      </Text>
      <Box
        aria-hidden
        height="1px"
        flex="1"
        minWidth="24px"
        backgroundImage={RULE}
      />
    </Flex>
  );
}

/**
 * One kind of thing and the four examples of it. The fragment holds two grid
 * cells rather than a wrapper, because a wrapper would be the grid item and
 * the two columns would collapse into one.
 */
function IntegrationRow({
  label,
  names,
  row,
}: {
  label: string;
  names: readonly string[];
  row: number;
}) {
  return (
    <Fragment>
      <Text
        gridColumn={1}
        gridRow={row}
        // Ranged against the spine rather than the panel's edge: the ragged
        // edge goes on the outside, where nothing lines up to it, and the
        // straight one sits against the line.
        textAlign="end"
        fontFamily={MONO_FONT}
        fontSize="10px"
        letterSpacing="0.09em"
        textTransform="uppercase"
        lineHeight="1.7"
        whiteSpace="nowrap"
        color="fg.subtle"
      >
        {label}
      </Text>
      <Flex
        as="ul"
        gridColumn={3}
        gridRow={row}
        listStyleType="none"
        margin={0}
        padding={0}
        flexWrap="wrap"
        columnGap="16px"
        rowGap="4px"
        aria-label={label}
      >
        {names.map((name) => (
          <Text
            as="li"
            key={name}
            fontSize="13px"
            lineHeight="1.6"
            color="fg.muted"
            whiteSpace="nowrap"
          >
            {name}
          </Text>
        ))}
      </Flex>
    </Fragment>
  );
}
