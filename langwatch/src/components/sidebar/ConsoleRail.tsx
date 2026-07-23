import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SidebarHeaderToggle } from "./SidebarHeaderToggle";

/** The rail column's logo/collapse row, above the nav. */
const RAIL_LOGO_ROW_HEIGHT = 52;

/**
 * The console rail: the shell's full-height warm-ink navigation column.
 *
 * The rail is a fixed instrument — the same ink in both app themes — so the
 * whole column is a dark-scoped subtree: everything rendered inside resolves
 * its dark-theme token form regardless of the app theme (badges, pills, and
 * progress tracks come along for free). Rail-specific values live in the
 * single-value `nav.*` tokens.
 *
 * Spec: specs/navigation/shell-visual-language.feature
 * ADR: dev/docs/adr/062-console-shell-visual-language.md
 */
export const ConsoleRail = ({
  width,
  isCollapsed,
  canToggle,
  onToggleCollapsed,
  children,
}: {
  width: string;
  isCollapsed: boolean;
  canToggle: boolean;
  onToggleCollapsed: (collapsed: boolean) => void;
  /** The nav menu filling the column below the logo row. */
  children: ReactNode;
}) => (
  <Box
    className="dark"
    data-theme="dark"
    data-testid="console-rail"
    width={width}
    minWidth={width}
    height="100vh"
    background="nav.bg"
    display="flex"
    flexDirection="column"
  >
    <Box
      height={`${RAIL_LOGO_ROW_HEIGHT}px`}
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent={isCollapsed ? "center" : "flex-start"}
      paddingX={isCollapsed ? 0 : 2}
    >
      <SidebarHeaderToggle
        isCollapsed={isCollapsed}
        canToggle={canToggle}
        onToggle={onToggleCollapsed}
      />
    </Box>
    <Box flex={1} minHeight={0}>
      {children}
    </Box>
  </Box>
);
