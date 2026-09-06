import { Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The one way a home section announces itself.
 *
 * Every section on the spine used to do this differently: one was a serif
 * display line, one a `Heading size="sm"`, one was not a heading at all but a
 * medium-weight `Text`, and one was a mono uppercase kicker with a middot
 * subtitle. Four dialects down one column is what makes a page read as
 * assembled rather than designed, and each new section was inventing a fifth.
 *
 * So the form is fixed here rather than at each call site:
 *
 *   - TITLE, in the interface font, sentence case. Always present. NOT the
 *     serif display voice: that belongs to the page's one big line (the
 *     greeting) and to the lit block. A serif on every section title spends the
 *     display voice on four things at once, and a voice used everywhere stops
 *     being a voice.
 *   - QUALIFIER, optional: the one fact that scopes the title and would
 *     otherwise be misread by its absence, like the window a figure covers or
 *     how much of a checklist is done. It rides WITH the title, because a
 *     qualifier parked elsewhere is a qualifier nobody connects to the number.
 *   - ACTIONS, optional, pushed to the trailing edge. Whatever the section
 *     needs: links out, a progress bar, a control.
 *
 * There is deliberately no "subtitle" slot. Every section that had one was
 * using it to restate its own title.
 *
 * SPACING IS OWNED HERE TOO, via the two constants below. It was previously
 * chosen per section — cards padded 3 or 4, header-to-content gaps of 2 or 3 —
 * which is why the titles did not sit on a common line down the column. A
 * shared header that leaves its own margins to its callers is only half a
 * shared header.
 */

/** Padding for a home section's card. One value, so titles start level. */
export const HOME_SECTION_PADDING = 4;
/** Gap between a section's header and its content, and between content rows. */
export const HOME_SECTION_GAP = 3;
export function HomeSectionHeader({
  title,
  qualifier,
  children,
}: {
  title: string;
  /** Scopes the title. Rendered as a quiet chip beside it. */
  qualifier?: ReactNode;
  /** Trailing controls, pushed right. */
  children?: ReactNode;
}) {
  return (
    <HStack width="full" gap={2.5} align="center" wrap="wrap">
      <Heading
        as="h2"
        fontWeight="600"
        fontSize="15px"
        letterSpacing="-0.01em"
        color="fg"
        lineHeight="1.3"
      >
        {title}
      </Heading>
      {qualifier ? (
        <Text
          fontFamily="mono"
          fontSize="11px"
          color="fg.muted"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="full"
          paddingX={2}
          whiteSpace="nowrap"
        >
          {qualifier}
        </Text>
      ) : null}
      {children ? (
        <>
          <Spacer />
          {children}
        </>
      ) : null}
    </HStack>
  );
}
