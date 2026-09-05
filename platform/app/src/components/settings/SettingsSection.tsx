import { Box, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The page's one vertical measure, named so the page header can match it.
 *
 * Everything else on a settings page is a fraction of it: half between a
 * band's two halves, and a third between a heading and what it heads. Spacing
 * that comes from one number reads as deliberate; spacing that comes from four
 * unrelated ones reads as an accident, which is exactly how it looked.
 */
export const SETTINGS_BAND_PADDING_Y = { base: 5, md: 6 };

/**
 * The air between the two halves of a band that covers two things — the same
 * measure, so two halves sit exactly half as far apart as two bands do (each
 * band contributes its own padding to the distance across a rule).
 */
export const SETTINGS_BLOCK_GAP = { base: 6, md: 7 };

/**
 * One section of a settings page: a titled band on the page itself, with a
 * single line saying what it is for, an optional action on the same line, and
 * a body.
 *
 * It exists because /settings/security had sections that each invented
 * their own chrome — one a bordered card, one a heading with a separator above
 * it, one a bare stack of rows with no title at all — and the page read as
 * four pages stacked. A settings page is a list of things you can change, and
 * the only thing the eye needs is where each one starts and ends.
 *
 * ── Flat, not boxed ─────────────────────────────────────────────────────
 *
 * A panel per section drew a border around content that is already bounded by
 * the page, and the result was a column of boxes with a box inside most of
 * them. So a section sits ON the page: a hairline above it, generous space
 * either side of that line, and nothing else. The first one draws no rule,
 * because a line under a page header is a line about nothing.
 *
 * The title is the only bold thing in a section; the description is one muted
 * line and never two; and the header's action slot takes a quiet control,
 * because a section header is a label, not a call to action.
 *
 * A section that renders nothing must render NOTHING — the wrapper belongs
 * inside the component that decides whether it has anything to say, or the
 * page grows a rule with empty space under it.
 */
export function SettingsSection({
  anchorId,
  icon,
  title,
  description,
  badge,
  action,
  testId,
  children,
}: {
  /** What a link elsewhere on the page scrolls to. */
  anchorId?: string;
  /** A 18px lucide glyph, or nothing. Set in the muted ink, never in colour. */
  icon?: ReactNode;
  /** Sentence case, naming the thing rather than the verb. */
  title: string;
  /** ONE line. Anything longer belongs in the section, next to what it is
   *  about — a header that has to be read is a header nobody reads. */
  description?: string;
  /** A state the section is in, beside the title. */
  badge?: ReactNode;
  /** The section's own control, on the title line: quiet, never the primary. */
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Box
      as="section"
      id={anchorId}
      width="full"
      borderTopWidth="1px"
      borderColor="border.muted"
      // ONE rhythm, and every band keeps it — no first-child exception. A rule
      // above the first band separates it from the page header exactly the way
      // the next rule separates it from the band below, and the header carries
      // the same padding underneath it. The exception is what made the spacing
      // read as arbitrary: the page header sat 24px from the first band while
      // the bands sat 64px from each other.
      paddingY={SETTINGS_BAND_PADDING_Y}
      // A link from the summary rail lands here, not under the app header.
      scrollMarginTop="72px"
      data-testid={testId}
    >
      <VStack width="full" align="stretch" gap={5}>
        <VStack width="full" align="stretch" gap={1}>
          <HStack width="full" gap={2} align="center">
            {icon ? (
              <Box color="fg.muted" display="flex" flexShrink={0}>
                {icon}
              </Box>
            ) : null}
            <Text fontSize="md" fontWeight={600} letterSpacing="-0.01em">
              {title}
            </Text>
            {badge}
            {action ? (
              <>
                <Spacer />
                {action}
              </>
            ) : null}
          </HStack>
          {description ? (
            <Text fontSize="sm" lineHeight="1.55" color="fg.muted">
              {description}
            </Text>
          ) : null}
        </VStack>
        {children}
      </VStack>
    </Box>
  );
}

/**
 * One half of a section that covers two things.
 *
 * A band exists per SUBJECT, not per feature, so a subject with two halves —
 * passkeys and two-step verification, which are one question about proving
 * who you are — gets one heading and two labelled blocks under it rather than
 * two bands that imply two unrelated topics.
 *
 * The label sits one step down from the section's own: the same weight, a
 * smaller size, and no rule of its own. Anything that needs a third level is
 * a sign the band is carrying two subjects after all.
 */
export function SettingsSectionBlock({
  title,
  badge,
  testId,
  children,
}: {
  title: string;
  /** A state this half is in, beside its label. */
  badge?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <VStack width="full" align="stretch" gap={3} data-testid={testId}>
      <HStack width="full" gap={2} align="center">
        <Text fontSize="sm" fontWeight={600}>
          {title}
        </Text>
        {badge}
      </HStack>
      {children}
    </VStack>
  );
}

/**
 * One item in a section's list — a passkey, a linked account, an address.
 *
 * The outer chrome is gone, so this is where the eye is told one row ends and
 * the next begins. One treatment for all three lists, because a passkey, a
 * linked account and an address are the same kind of thing to a reader: a way
 * in, with something they can do to it.
 */
export function SettingsSectionRow({
  testId,
  children,
}: {
  testId?: string;
  children: ReactNode;
}) {
  return (
    <HStack
      width="full"
      gap={3}
      paddingX={4}
      paddingY={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      data-testid={testId}
    >
      {children}
    </HStack>
  );
}
