import { LangyMark } from "@langwatch/design-system/langy-mark";
import { Box, chakra, Text, VStack } from "@langwatch/design-system/primitives";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { emptyStateMetrics } from "../../model/langy-empty-state-metrics.ts";
import type { LangySuggestion, SuggestionIcon } from "../../model/langy-suggestions.ts";

/**
 * The opening line, of which there are three.
 */
const GREETINGS = ["Hey, I'm Langy!"];

export function EmptyState({
  onPick,
  suggestions,
  variant = "floating",
  panelWidth = 432,
}: {
  onPick: (prompt: string) => void;
  /**
   * The asks this project can actually act on, picked by the panel via
   * `selectLangySuggestions` from the project's reach — the same selection the home
   * page runs, so the two surfaces can never disagree about what is honest to offer.
   */
  suggestions: LangySuggestion[];
  variant?: "floating" | "sidebar";
  /**
   * The panel's real rendered width. The floating card ranges ~340–432px with the
   * viewport and the dock is fixed at 392px, so the hero + rows size off THIS rather
   * than the mode — a narrow card no longer gets the same big hero as a roomy one.
   */
  panelWidth?: number;
}) {
  const sidebar = variant === "sidebar";
  const metrics = emptyStateMetrics({ variant, width: panelWidth });
  const greeting = useMemo(() => GREETINGS[Math.floor(Math.random() * GREETINGS.length)], []);
  return (
    <VStack
      // The invitation belongs to a genuinely new chat. Named so the restore
      // path can pin that it is NOT what a loading conversation shows, without
      // the assertion resting on which greeting was picked.
      data-testid="langy-empty-state"
      align="stretch"
      gap={0}
      // `flex="1"` fills the docked sidebar's flex column so `justify="center"`
      // actually centres the hero in the tall dock (ignored in the floating
      // card, whose flow-root parent leaves the state top-aligned as before).
      // `height="full"` keeps the centring working in the floating card's fixed
      // min-height too.
      flex="1"
      height="full"
      justify={sidebar ? "flex-start" : "center"}
      // One centred measure for the whole empty state — the hero and the suggestion
      // list share these bounds, so nothing sits in its own width (the subtitle used to
      // be capped at 260px while the list ran the full ~428px).
      maxWidth="360px"
      marginX="auto"
      width="full"
      paddingX={3}
      paddingY={sidebar ? 6 : 8}
    >
      <VStack gap={0} align="center" marginBottom={`${metrics.heroMarginBottom}px`}>
        {/* The LangWatch mark, in the brand gradient — and the ONLY place it
            appears inside the panel (the minimised peek is the other). Bare, no tile:
            the orange chip that used to box it in was old-brand chrome, a
            saturated block competing with the display line right under it. It
            shrinks with the card but never below 34px, the smallest size at
            which the box's wireframe still reads as a box rather than a smudge. */}
        <LangyMark size={metrics.markSize} />
        <Text
          fontFamily="var(--langy-font-serif)"
          // At full width the 27px heading is the 44px mark ÷ φ (mark and heading
          // in the golden ratio); both ease down together as the card narrows so
          // the ratio holds across sizes. See `emptyStateMetrics`.
          fontSize={`${metrics.greetingSize}px`}
          fontWeight="500"
          letterSpacing="-0.02em"
          color="fg"
          textAlign="center"
          marginTop={`${metrics.heroGapTop}px`}
        >
          {greeting}
        </Text>
        {/* An invitation, then the two keys worth knowing.
            "Ask in plain language" was an instruction nobody needs — anyone
            looking at a text box already knows they can type in it — and it
            spent the one line under the hero saying so. The line now gets out
            of the way, and the space goes to the two things a first-time
            reader could not have guessed. */}
        <Text
          textStyle="sm"
          color="fg.muted"
          lineHeight="1.5"
          textAlign="center"
          textWrap="balance"
          maxWidth={`${metrics.subtitleMaxWidth}px`}
          marginTop={2}
        >
          {/* "One of these" only when there are rows to point at — while the
              project's reach is unknown the list below is empty on purpose. */}
          {suggestions.length > 0
            ? "Just type away, or start with one of these."
            : "Just type away."}
        </Text>
        <Text
          textStyle="xs"
          // Quieter and lighter than the line above: this is a reference the
          // eye should find when it goes looking, not a second invitation
          // competing with the first.
          fontWeight="400"
          color="fg.subtle"
          textAlign="center"
          marginTop={1.5}
        >
          <chakra.span fontFamily="mono" color="fg.muted">
            /
          </chakra.span>{" "}
          for skills{"  ·  "}
          <chakra.span fontFamily="mono" color="fg.muted">
            #
          </chakra.span>{" "}
          to add context
        </Text>
      </VStack>

      {/* Cards need air between them in a way bare rows did not — at the old
          2px they would read as one segmented control. */}
      <VStack align="stretch" gap={1.5}>
        {sidebar && suggestions.length > 0 ? (
          <Text
            textStyle="2xs"
            fontWeight="600"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="fg.subtle"
            paddingX="10px"
            paddingBottom={1.5}
          >
            Suggested
          </Text>
        ) : null}
        {suggestions.map(({ icon, label, prompt }) => (
          <SuggestionRow
            key={label}
            icon={icon}
            label={label}
            paddingX={metrics.rowPaddingX}
            paddingY={metrics.rowPaddingY}
            gap={metrics.rowGap}
            onClick={() => onPick(prompt)}
          />
        ))}
      </VStack>
    </VStack>
  );
}

function SuggestionRow({
  icon: Icon,
  label,
  onClick,
  paddingX,
  paddingY,
  gap,
}: {
  icon: SuggestionIcon;
  label: string;
  onClick: () => void;
  /** Row sizing eases with the panel width — see `emptyStateMetrics`. */
  paddingX: number;
  paddingY: number;
  gap: number;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={`${gap}px`}
      width="full"
      textAlign="left"
      paddingX={`${paddingX}px`}
      paddingY={`${paddingY}px`}
      borderRadius="12px"
      // A resting SHAPE, not a bare row.
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      background="bg.panel/60"
      backdropFilter="blur(8px)"
      color="fg"
      cursor="pointer"
      transition="background 130ms ease, border-color 130ms ease, transform 130ms ease"
      _hover={{
        background: "bg.panel/85",
        borderColor: "orange.emphasized",
        transform: "translateY(-1px)",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "orange.emphasized",
        outlineOffset: "2px",
      }}
      css={{
        "&:hover .chev": { opacity: 1, transform: "translateX(0)" },
        "&:hover .row-icon": { color: "var(--chakra-colors-fg)" },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" },
        "@media (prefers-reduced-motion: reduce):hover": {
          transform: "none",
        },
      }}
    >
      {/* Neutral, not orange. Four saturated icons stacked down the empty state
          read as a toolbar; the panel's only colour should be the mark. */}
      <Box
        className="row-icon"
        color="fg.subtle"
        flexShrink={0}
        display="grid"
        placeItems="center"
        transition="color 130ms ease"
      >
        <Icon size={16} />
      </Box>
      <Text textStyle="sm" fontWeight="500" flex={1}>
        {label}
      </Text>
      <Box
        className="chev"
        color="fg.subtle"
        opacity={0}
        transform="translateX(-3px)"
        transition="opacity 130ms ease, transform 130ms ease"
      >
        <ChevronRight size={15} />
      </Box>
    </chakra.button>
  );
}
