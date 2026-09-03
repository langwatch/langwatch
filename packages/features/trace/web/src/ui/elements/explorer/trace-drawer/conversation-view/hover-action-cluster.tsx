import { Button, HStack, Icon, Text } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";
import { forwardRef } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";

/**
 * A small toolbar that arrives with the pointer, on a surface of its own.
 *
 * Kept out of the way until the thing it belongs to is hovered: a conversation
 * that showed every turn's actions at all times would read as chrome with a
 * transcript in it. An opaque panel rather than bare words, so the revealed
 * actions read as a toolbar floating over the message or the separator instead
 * of as text printed on top of it.
 *
 * The keyboard reaches it by landing on one of its own actions, which is what
 * brings it out for a reader who has no pointer. Something else in the same
 * group holding focus does not: a ticked session checkbox keeps its focus long
 * after the pointer has moved on, and the actions are meant to leave with the
 * pointer.
 *
 * `isHeld` keeps the cluster on screen regardless of the pointer, for as long
 * as what it started is still going: the control the reviewer clicked must not
 * vanish from under them.
 */
export const HoverActionCluster = forwardRef<
  HTMLDivElement,
  {
    isHeld?: boolean;
    label: string;
    children: React.ReactNode;
  }
>(function HoverActionCluster({ isHeld = false, label, children }, ref) {
  return (
    <HStack
      ref={ref}
      role="group"
      aria-label={label}
      gap={0.5}
      flexShrink={0}
      flexWrap="wrap"
      justify="flex-end"
      // The message and the separator underneath both open the turn when they
      // are clicked, so the gesture stops at the toolbar.
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="sm"
      boxShadow="sm"
      paddingX={1}
      paddingY={0.5}
      opacity={isHeld ? 1 : 0}
      _groupHover={{ opacity: 1 }}
      _focusWithin={{ opacity: 1 }}
      transition="opacity 120ms ease"
      // Hover is also what makes the toolbar a click target: while it is not
      // revealed it lies over what it belongs to and would swallow the click
      // that selects the turn. The rule is scoped to pointers that can hover,
      // because a pointer that cannot has no way to reveal the toolbar and
      // would be left unable to reach the actions at all.
      css={{
        "@media (hover: hover)": {
          pointerEvents: isHeld ? "auto" : "none",
          ".group:hover &, &:focus-within": { pointerEvents: "auto" },
        },
      }}
    >
      {children}
    </HStack>
  );
});

/** One action in a hover cluster: an icon, a word, and what it does. */
export function HoverActionButton({
  icon,
  label,
  tooltip,
  accessibleName,
  isActive = false,
  isDisabled = false,
  isPressed,
  onActivate,
}: {
  icon: LucideIcon;
  label: string;
  /** What the pointer is told the action does. */
  tooltip: string;
  /**
   * The name the action answers to, when the word on it is not enough to tell
   * it from the same action on the other message. Left unset the word itself is
   * the name, which is what a toggle needs: its label already says which of the
   * two states it is in.
   */
  accessibleName?: string;
  isActive?: boolean;
  isDisabled?: boolean;
  /** Set on a toggle, so the pressed state is announced rather than implied. */
  isPressed?: boolean;
  onActivate: () => void;
}) {
  return (
    <Tooltip content={tooltip} positioning={{ placement: "top" }}>
      <Button
        size="2xs"
        variant="ghost"
        color={isActive ? "blue.fg" : "fg.muted"}
        gap={1}
        paddingX={1.5}
        height="18px"
        aria-label={accessibleName}
        aria-pressed={isPressed}
        disabled={isDisabled}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
      >
        <Icon as={icon} boxSize={3} />
        <Text textStyle="2xs">{label}</Text>
      </Button>
    </Tooltip>
  );
}
