import { Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Link } from "~/components/ui/link";

/**
 * What a panel says when it has nothing to draw.
 *
 * "Not available." was the whole of it, and it answered none of the three
 * questions a reader actually has: what is this panel, why is it blank, and
 * what would fill it. A blank panel that explains nothing reads as a broken
 * feature, and the reader's next move on seeing it is to report a bug against
 * a screen working exactly as designed.
 *
 * So every empty panel on this page names what appears in it and what has to
 * happen for it to hold figures, and offers the one move that would do it
 * where such a move exists.
 *
 * The two blank states stay apart, which is the distinction the charts have
 * always drawn and the reason this takes `unanswered` rather than one fixed
 * sentence:
 *
 *   - UNANSWERED: the read has not come back, or the viewer was never allowed
 *     to run it. Nothing was measured, so nothing is claimed about the window.
 *   - MEASURED AND EMPTY: the read answered and the window holds nothing. That
 *     is a finding, and the panel is allowed to say so — collapsing the two
 *     would report a result the screen does not have.
 *
 * The action is a link rather than a button because every one of them is a
 * navigation, and a button that navigates loses the reader's middle click.
 */
export interface CostPanelEmptyProps {
  /** One line: what this panel shows, in the reader's words. */
  what: string;
  /** One line: what has to happen for it to hold figures. */
  source: string;
  /** The one move that would fill it, when there is one. */
  action?: { label: string; to: string };
  /** True when no read has answered. See the two states above. */
  unanswered: boolean;
  height?: string;
}

export function CostPanelEmpty({
  what,
  source,
  action,
  unanswered,
  height = "220px",
}: CostPanelEmptyProps) {
  return (
    <VStack
      data-testid="cost-panel-empty"
      align="start"
      justify="center"
      height={height}
      gap={1}
      color="fg.muted"
    >
      <Text fontSize="sm" color="fg">
        {unanswered ? what : "Nothing in this window yet."}
      </Text>
      <Text fontSize="sm">{unanswered ? source : what}</Text>
      {action && (
        <Link href={action.to} fontSize="sm" marginTop={1}>
          {action.label} →
        </Link>
      )}
    </VStack>
  );
}

/**
 * A panel's empty copy, bound to everything but which of the two states it is
 * in. The charts decide that — they are the ones holding the rows — so the
 * page hands them this and they call it with the answer.
 */
export function costPanelEmpty(
  props: Omit<CostPanelEmptyProps, "unanswered">,
): (unanswered: boolean) => ReactNode {
  return (unanswered: boolean) => (
    <CostPanelEmpty {...props} unanswered={unanswered} />
  );
}
