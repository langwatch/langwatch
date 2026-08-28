/**
 * The shared layout of the Agent Testing tabs.
 *
 * Both tabs read as a rail on the left and a centred content column on the
 * right. The content column carries the same width and the same centring rule
 * across the two tabs, so the eye lines up when a person moves from Scenarios
 * to Results. When a tab has no real rail on the left, the layout still keeps
 * the same left offset with an invisible spacer of the same width, so the
 * content never shifts.
 *
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, HStack } from "@chakra-ui/react";

/**
 * How wide the shared left rail reads. Cases uses this for the suites rail,
 * Results uses this for the runs sidebar, and the plans list uses this for the
 * invisible spacer that keeps the table lined up with the cases table.
 */
export const AGENT_TESTING_RAIL_WIDTH = 218;

export type AgentTestingTabLayoutProps = {
  /** The rail on the left of the tab, or an invisible spacer when there is none. */
  rail?: React.ReactNode;
  /** The centred content column of the tab. */
  children: React.ReactNode;
  /**
   * Whether an empty rail slot still takes a rail's width. A surface that has
   * no rail of its own sets this false and centres on the whole page.
   */
  reserveRailSpace?: boolean;
  "data-testid"?: string;
};

/**
 * The tab wrapper: a rail slot on the left, and the content column beside it.
 *
 * The two tabs pass their own rail (the suites rail on Scenarios, the runs
 * sidebar on a plan detail), or leave the slot empty and get an invisible
 * spacer that keeps the content column at the same left offset as the other
 * tab. Every content column of the page routes through this wrapper.
 */
export function AgentTestingTabLayout({
  rail,
  children,
  reserveRailSpace = true,
  ...rest
}: AgentTestingTabLayoutProps) {
  return (
    <HStack
      width="full"
      height="full"
      gap={0}
      alignItems="stretch"
      data-testid={rest["data-testid"]}
    >
      {rail ??
        (reserveRailSpace ? (
          <Box
            width={`${AGENT_TESTING_RAIL_WIDTH}px`}
            minWidth={`${AGENT_TESTING_RAIL_WIDTH}px`}
            aria-hidden
            data-testid="agent-testing-rail-spacer"
          />
        ) : null)}
      {children}
    </HStack>
  );
}
