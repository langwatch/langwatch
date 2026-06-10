import { Box, chakra, HStack, Icon, Text } from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type { ReactNode } from "react";

const PaneButton = chakra("button");

/**
 * Where the pane sits inside its `<PanelGroup>`. Drives the
 * collapse-icon orientation:
 *
 *   - **Vertical layout** (`"top"` / `"bottom"`): plain caret —
 *     `ChevronDown` when expanded, `ChevronRight` when collapsed. This
 *     is the same disclosure affordance the rest of the app uses for
 *     stacked sections and reads well at small sizes.
 *   - **Horizontal split** (`"left"` / `"right"`): use lucide's
 *     `PanelLeftOpen` / `PanelLeftClose` (and right variants) so the
 *     icon visually hints which side the pane sits on and which way
 *     it'll fold away. Matches the DevTools panel-position chooser.
 */
export type PanePosition = "top" | "bottom" | "left" | "right";

function collapseIconFor(position: PanePosition, collapsed: boolean) {
  switch (position) {
    case "left":
      return collapsed ? PanelLeftOpen : PanelLeftClose;
    case "right":
      return collapsed ? PanelRightOpen : PanelRightClose;
    case "top":
    case "bottom":
    default:
      return collapsed ? ChevronRight : ChevronDown;
  }
}

export interface PaneProps {
  title: string;
  /** Optional icon node rendered to the left of the title. */
  icon?: ReactNode;
  /** Optional right-aligned slot in the header (extra chips/buttons). */
  rightSlot?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Where the pane sits in its group — drives the collapse-icon
   * orientation. Defaults to "top" (the legacy stacked layout). */
  position?: PanePosition;
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
  position = "top",
  children,
}: PaneProps) {
  const collapseLabel = collapsed ? "Expand pane" : "Collapse pane";
  const CollapseIcon = collapseIconFor(position, collapsed);

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
        collapseLabel={collapseLabel}
        CollapseIcon={CollapseIcon}
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
    "title" | "icon" | "rightSlot" | "collapsed" | "onToggleCollapsed"
  > {
  collapseLabel: string;
  CollapseIcon: React.ElementType;
}

function PaneHeader({
  title,
  icon,
  rightSlot,
  collapsed,
  onToggleCollapsed,
  collapseLabel,
  CollapseIcon,
}: PaneHeaderProps) {
  const handleHeaderDoubleClick = (e: React.MouseEvent<HTMLElement>) => {
    // Double-click on the header collapses / expands the pane. Ignore
    // bubbled double-clicks from the chevron itself — it has its own
    // click handler and the second click would just toggle right back.
    const target = e.target as HTMLElement | null;
    if (target && target.closest("[data-pane-collapse]")) return;
    onToggleCollapsed?.();
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
      // Devtools-style 1px border on both top and bottom so the header
      // reads as a distinct strip between the surfaces above and below
      // (mirrors Chrome's Network → Headers / Cookies / … tab row).
      borderTopWidth="1px"
      borderBottomWidth="1px"
      borderColor="border.muted"
      flexShrink={0}
      cursor="default"
      userSelect="none"
      onDoubleClick={handleHeaderDoubleClick}
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
        <Icon as={CollapseIcon} boxSize={3.5} />
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
    </HStack>
  );
}
