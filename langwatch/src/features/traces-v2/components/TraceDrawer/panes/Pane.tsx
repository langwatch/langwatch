import { Box, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import { ChevronDown, ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import type { ReactNode } from "react";
import { Tooltip } from "~/components/ui/tooltip";

const PaneButton = chakra("button");

export interface PaneProps {
  title: string;
  /** Optional icon node rendered to the left of the title. */
  icon?: ReactNode;
  /** Optional right-aligned slot in the header (extra chips/buttons). */
  rightSlot?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Pane is maximized within its group (siblings hidden). */
  maximized?: boolean;
  onToggleMaximized?: () => void;
  /** When `false`, the maximize control is hidden — useful for a pane
   * that is the only one in its group. */
  canMaximize?: boolean;
  children: ReactNode;
}

/**
 * Drawer pane primitive.
 *
 * Layout: a gray header bar with title + collapse/maximize controls, then
 * a content area that owns its own vertical scroll. The pane never grows
 * its own content past the available height — it relies on the parent
 * (`<PanelGroup>` from `react-resizable-panels` or a flex parent) to
 * decide how much vertical/horizontal space to give it.
 *
 * In light mode the header is `bg.muted` and the content is `bg.surface`
 * (white). In dark mode the tokens flip so the header reads as a slight
 * elevation against the panel surface. The intent is to mirror the
 * Chrome DevTools panel chrome where the eye anchors on the gray header
 * row and the content reads as a clean white sheet.
 */
export function Pane({
  title,
  icon,
  rightSlot,
  collapsed = false,
  onToggleCollapsed,
  maximized = false,
  onToggleMaximized,
  canMaximize = true,
  children,
}: PaneProps) {
  const collapseLabel = collapsed ? "Expand pane" : "Collapse pane";
  const maximizeLabel = maximized ? "Restore pane" : "Maximize pane";

  return (
    <Box
      display="flex"
      flexDirection="column"
      height="100%"
      width="100%"
      minHeight={0}
      minWidth={0}
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      <PaneHeader
        title={title}
        icon={icon}
        rightSlot={rightSlot}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
        maximized={maximized}
        onToggleMaximized={onToggleMaximized}
        canMaximize={canMaximize}
        collapseLabel={collapseLabel}
        maximizeLabel={maximizeLabel}
      />
      {!collapsed && (
        <Box
          flex={1}
          minHeight={0}
          minWidth={0}
          overflow="auto"
          // Pane is the only scroll surface for its content — anchoring
          // would compensate for hidden sibling chrome inside the pane
          // and silently jump scrollTop. We disable it.
          style={{ overflowAnchor: "none" }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}

interface PaneHeaderProps
  extends Pick<
    PaneProps,
    | "title"
    | "icon"
    | "rightSlot"
    | "collapsed"
    | "onToggleCollapsed"
    | "maximized"
    | "onToggleMaximized"
    | "canMaximize"
  > {
  collapseLabel: string;
  maximizeLabel: string;
}

function PaneHeader({
  title,
  icon,
  rightSlot,
  collapsed,
  onToggleCollapsed,
  maximized,
  onToggleMaximized,
  canMaximize,
  collapseLabel,
  maximizeLabel,
}: PaneHeaderProps) {
  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    // Ignore double-clicks that bubble from the collapse / maximize
    // buttons inside the header — those buttons have their own
    // click handlers and a second click on them should not also
    // toggle the maximize gesture. Walk up to see if the original
    // target is a control.
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-pane-control], [data-pane-collapse]")) {
      return;
    }
    // Double-click on the header is the keyboard-free maximize gesture.
    // Falls through to collapse when maximize is unavailable so the
    // double-click is never inert.
    if (canMaximize && onToggleMaximized) {
      onToggleMaximized();
    } else if (onToggleCollapsed) {
      onToggleCollapsed();
    }
  };

  return (
    <HStack
      as="header"
      role="toolbar"
      aria-label={`${title} pane controls`}
      gap={2}
      paddingX={3}
      paddingY={1.5}
      bg={{ base: "bg.muted", _dark: "bg.subtle" }}
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
      cursor="default"
      userSelect="none"
      onDoubleClick={handleHeaderDoubleClick}
      _hover={{
        "& [data-pane-control]": { opacity: 1 },
      }}
    >
      <PaneButton
        type="button"
        data-pane-collapse
        onClick={onToggleCollapsed}
        aria-label={collapseLabel}
        display="inline-flex"
        alignItems="center"
        color="fg.muted"
        cursor="pointer"
        bg="transparent"
        border="0"
        padding={0}
        _hover={{ color: "fg" }}
      >
        <Icon
          as={collapsed ? ChevronRight : ChevronDown}
          boxSize={3.5}
        />
      </PaneButton>
      {icon ? (
        <Box display="inline-flex" alignItems="center" color="fg.muted">
          {icon}
        </Box>
      ) : null}
      <Text
        textStyle="xs"
        fontWeight="600"
        color="fg"
        textTransform="uppercase"
        letterSpacing="0.04em"
        flex={1}
        truncate
      >
        {title}
      </Text>
      {rightSlot ? (
        <Box display="inline-flex" alignItems="center" gap={1}>
          {rightSlot}
        </Box>
      ) : null}
      {canMaximize && onToggleMaximized && !collapsed ? (
        <Tooltip
          content={maximizeLabel}
          positioning={{ placement: "bottom" }}
          openDelay={400}
        >
          <PaneButton
            type="button"
            data-pane-control
            onClick={onToggleMaximized}
            aria-label={maximizeLabel}
            display="inline-flex"
            alignItems="center"
            color="fg.muted"
            opacity={0.6}
            transition="opacity 120ms ease"
            cursor="pointer"
            bg="transparent"
            border="0"
            padding={0}
            _hover={{ color: "fg" }}
          >
            <Icon as={maximized ? Minimize2 : Maximize2} boxSize={3} />
          </PaneButton>
        </Tooltip>
      ) : null}
    </HStack>
  );
}
