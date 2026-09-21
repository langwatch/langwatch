import { Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The title block every settings page opens with.
 *
 * ONE COMPONENT BECAUSE THERE WAS ONE PATTERN AND FOUR SPELLINGS OF IT. The
 * pages of the access cluster — Authentication, Access, Roles, Directory — each
 * wrote their own: the same heading over the same muted line, at gaps of 1 and
 * 2, one of them inside an `HStack` and one of them under a page column with a
 * second helping of padding and a narrower cap than `SettingsLayout` already
 * gives it. Nothing chose those differences; they accumulated. Read one after
 * another the pages looked like four products.
 *
 * The layout owns the page's padding and width. A page that adds its own is
 * indenting itself inside a container that already indented it, which is the
 * bug this component's absence kept reintroducing.
 */
export function SettingsPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  /** One quiet line saying what the page is for. */
  description: ReactNode;
  /** Controls belonging to the page as a whole, pinned to the far end. */
  actions?: ReactNode;
}) {
  return (
    <HStack align="start" width="full" gap={4}>
      <VStack align="start" gap={1}>
        <Heading size="lg" letterSpacing="-0.01em">
          {title}
        </Heading>
        {/* Capped at a line length the eye can track back from. Unbounded,
            a long description runs to the actions at the far end and reads
            as if it belonged to them. */}
        <Text color="fg.muted" fontSize="sm" maxW="70ch">
          {description}
        </Text>
      </VStack>
      {actions ? (
        <>
          <Spacer />
          {actions}
        </>
      ) : null}
    </HStack>
  );
}
