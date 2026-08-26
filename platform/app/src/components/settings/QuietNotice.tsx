import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CircleAlert, MailCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

/** What a notice is about. The tone sets the stripe and the glyph, nothing else. */
export type QuietNoticeTone = "warning" | "danger" | "success";

/**
 * The palette per tone, named rather than valued. Semantic tokens
 * (`colorPalette.solid`, `colorPalette.fg`) carry their own dark-mode reading,
 * which the hardcoded `orange.500` plus a `_dark` variant never did — two
 * spellings of one colour that had to be kept in step by hand.
 */
const TONES: Record<
  QuietNoticeTone,
  { colorPalette: string; icon: ReactNode }
> = {
  warning: {
    colorPalette: "orange",
    icon: <TriangleAlert size={15} />,
  },
  danger: {
    colorPalette: "red",
    icon: <CircleAlert size={15} />,
  },
  success: {
    colorPalette: "green",
    icon: <MailCheck size={15} />,
  },
};

/**
 * The one alert these account screens speak in — every warning, every failure,
 * one component with three tones.
 *
 * A solid band across the page is how a warning gets ignored: it reads as
 * chrome, it is the loudest thing on a screen whose subject is quieter than
 * it, and by the second sighting people stop seeing it. So this sits on the
 * page's own ground with one hairline, and the tone lives in a flat 3px stripe
 * down the leading edge and in the glyph beside the title.
 *
 * Three details do the work, and they are the difference between a designed
 * notice and a coloured box:
 *
 *   - the stripe is FLAT — the card's radius is dropped on that edge, so the
 *     accent is part of the card's boundary rather than a pill stuck to it;
 *   - the glyph is optically aligned to the TITLE, not centred against a block
 *     of two lines, which is what made it float;
 *   - the action rides the title line at width, and drops under the body when
 *     there is no room, so it is never a full-height orphan beside two lines
 *     of text.
 *
 * Density is an inline notice's: 14px of vertical padding, 16px of horizontal,
 * title at the body size in 600, body muted at 1.5.
 */
export function QuietNotice({
  tone = "warning",
  title,
  action,
  testId,
  children,
}: {
  tone?: QuietNoticeTone;
  /** One line, sentence case. The body says the rest. */
  title?: ReactNode;
  /** One quiet control. It rides the title line, or drops under the body. */
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  const { colorPalette, icon } = TONES[tone];

  return (
    <Box
      width="full"
      colorPalette={colorPalette}
      borderWidth="1px"
      borderColor="border.muted"
      borderLeftWidth="3px"
      borderLeftColor="colorPalette.solid"
      // ONE element, ONE radius, and the accent is the card's own left border
      // rather than a bar behind it. Both of the ways to get this wrong were
      // tried: a separate stripe reads as a sticker, and squaring the left
      // corners (`borderLeftRadius={0}`) ran the accent straight past a corner
      // the rest of the card curved away from. Because the colour lives on the
      // border, the corner rounds the accent with it — flush at all four
      // corners by construction, with nothing to overhang and no gap to leave.
      borderRadius="lg"
      paddingY={3.5}
      paddingX={4}
      data-testid={testId}
    >
      {/* The action is the third child and wraps as a whole when the row runs
          out of room, which is how it drops under the body at narrow widths
          without being rendered twice — two copies of one button is two things
          a test, and a screen reader, have to tell apart. */}
      <HStack align="start" gap={2.5} width="full" flexWrap="wrap">
        {/* One pixel down: optical alignment with the cap height of the line
            beside it, which mathematical alignment always misses. */}
        <Box
          color="colorPalette.fg"
          display="flex"
          flexShrink={0}
          marginTop="1px"
        >
          {icon}
        </Box>

        <VStack align="stretch" gap={0.5} flex="1 1 260px" minWidth={0}>
          {title ? (
            <Text fontSize="sm" fontWeight={600} lineHeight="1.45">
              {title}
            </Text>
          ) : null}

          <Box fontSize="sm" lineHeight="1.5" color="fg.muted">
            {children}
          </Box>
        </VStack>

        {action ? (
          <Box flexShrink={0} marginLeft="auto">
            {action}
          </Box>
        ) : null}
      </HStack>
    </Box>
  );
}
