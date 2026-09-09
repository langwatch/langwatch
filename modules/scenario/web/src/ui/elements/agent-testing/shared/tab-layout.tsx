/**
 * The shared layout of the Agent Testing tabs.
 * @see specs/features/agent-testing/page-structure.feature
 */

import { Box, HStack } from "@chakra-ui/react";

/**
 * How wide the shared left rail reads. Scenarios uses this for the suites rail,
 * Results uses this for the runs sidebar, and the plans list uses this for the
 * invisible spacer that keeps the table lined up with the scenarios table.
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
