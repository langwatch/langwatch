import { Box, IconButton } from "@chakra-ui/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { FullLogo } from "../icons/FullLogo";
import { LogoIcon } from "../icons/LogoIcon";
import { MENU_WIDTH_EXPANDED } from "../MainMenu";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { getSidebarToggleShortcut } from "./useSidebarCollapseHotkey";

export type SidebarHeaderToggleProps = {
  isCollapsed: boolean;
  /**
   * False on small screens, where the sidebar is always the icon rail and
   * the logo stays a plain home link.
   */
  canToggle: boolean;
  onToggle: (collapsed: boolean) => void;
};

/**
 * The logo block in the header's top-left, doubling as the sidebar
 * collapse/expand control:
 *
 *   - expanded: the full logo, with a collapse button fading in at the right
 *     edge of the logo strip on hover (or keyboard focus);
 *   - collapsed: the logo mark itself swaps to the expand button on hover,
 *     so the control sits exactly where the eye already is.
 *
 * Spec: specs/navigation/sidebar-collapse-preference.feature
 */
export const SidebarHeaderToggle = ({
  isCollapsed,
  canToggle,
  onToggle,
}: SidebarHeaderToggleProps) => {
  if (isCollapsed) {
    return (
      <Box
        data-group
        position="relative"
        width="28px"
        height="32px"
        flexShrink={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Box
          display="flex"
          alignItems="center"
          transition="opacity 0.1s ease-in-out"
          _groupHover={canToggle ? { opacity: 0 } : undefined}
        >
          <Link href="/" display="flex" alignItems="center">
            <LogoIcon width={25 * 0.7} height={32 * 0.7} />
          </Link>
        </Box>
        {canToggle && (
          <Tooltip
            content={`Expand sidebar · ${getSidebarToggleShortcut()}`}
            positioning={{ placement: "right" }}
          >
            <IconButton
              aria-label="Expand sidebar"
              size="xs"
              variant="ghost"
              position="absolute"
              inset={0}
              color="nav.fgMuted"
              opacity={0}
              transition="opacity 0.1s ease-in-out"
              _groupHover={{ opacity: 1 }}
              _focusVisible={{ opacity: 1 }}
              _hover={{ backgroundColor: "nav.bgHover" }}
              onClick={() => onToggle(false)}
            >
              <PanelLeftOpen size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  return (
    <Box
      data-group
      width={MENU_WIDTH_EXPANDED}
      minWidth={MENU_WIDTH_EXPANDED}
      paddingLeft={2}
      paddingRight={3}
      display="flex"
      alignItems="center"
      justifyContent="space-between"
    >
      <Link href="/" display="flex" alignItems="center">
        {/* The rail is ink in both themes, so the logo always wears its
            dark-surface form. */}
        <FullLogo width={155 * 0.7} height={38 * 0.7} forceColorMode="dark" />
      </Link>
      {canToggle && (
        <Tooltip
          content={`Collapse sidebar · ${getSidebarToggleShortcut()}`}
          positioning={{ placement: "right" }}
        >
          <IconButton
            aria-label="Collapse sidebar"
            size="xs"
            variant="ghost"
            color="nav.fgMuted"
            opacity={0}
            transition="opacity 0.1s ease-in-out"
            _groupHover={{ opacity: 1 }}
            _focusVisible={{ opacity: 1 }}
            _hover={{ backgroundColor: "nav.bgHover", color: "nav.fg" }}
            onClick={() => onToggle(true)}
          >
            <PanelLeftClose size={16} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};
