/**
 * The page for a board the reader may not open: deleted, or set to Only me by its author. It
 * says the same for both and shows no part of the board, as the server answers the same for both.
 * @see modules/dashboard/specs/dashboards-v2.feature AC183, dashboards-organization-area.feature
 */

import { Button, Heading, Text, VStack } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { Link } from "../../../../ui/elements/analytics-link.tsx";
import { BOARD_UNAVAILABLE } from "../../model/board-scope.ts";
import { ORGANIZATION_DASHBOARDS_PATH } from "../../model/boards.ts";
import { ORGANIZATION_BOARD_UNAVAILABLE } from "../../model/organization-board.ts";

export function BoardUnavailable({
  copy = BOARD_UNAVAILABLE,
  action,
}: {
  /** AC183's words unless the page says otherwise; the organization's area says its own. */
  copy?: Readonly<{ title: string; body?: string }>;
  /** Where the reader goes from here, when the page offers somewhere. */
  action?: ReactNode;
} = {}) {
  return (
    <VStack gap={3} paddingY={20} paddingX={6} textAlign="center" color="fg.muted">
      <Lock size={22} aria-hidden />
      <Heading as="h1" textStyle="pageTitle" color="fg">
        {copy.title}
      </Heading>
      {copy.body && (
        <Text textStyle="bodySm" maxWidth="md">
          {copy.body}
        </Text>
      )}
      {action}
    </VStack>
  );
}

/** The organization's area's wording (ADR-002), with a link back to its library. */
export function OrganizationBoardUnavailable() {
  return (
    <BoardUnavailable
      copy={{ title: ORGANIZATION_BOARD_UNAVAILABLE.title }}
      action={
        <Button asChild size="sm" variant="outline">
          <Link href={ORGANIZATION_DASHBOARDS_PATH} _hover={{ textDecoration: "none" }}>
            {ORGANIZATION_BOARD_UNAVAILABLE.back}
          </Link>
        </Button>
      }
    />
  );
}
