import { Box, HStack, Text } from "@chakra-ui/react";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { usePresencePreferencesStore } from "~/features/presence/stores/presencePreferencesStore";
import { ICON_SIZE, MENU_ITEM_HEIGHT } from "./SideMenuLink";

export type PresenceToggleProps = {
  showLabel?: boolean;
};

/**
 * Sidebar control that lets the user opt out of broadcasting which trace
 * (and location within it) they're viewing. Green dot = sharing trace
 * location, grey = hidden.
 */
export const PresenceToggle = ({ showLabel = true }: PresenceToggleProps) => {
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  const toggleHidden = usePresencePreferencesStore((s) => s.toggleHidden);

  const visible = !hidden;
  const Icon = visible ? LuEye : LuEyeOff;
  const label = visible ? "Sharing trace location" : "Trace location hidden";
  const tooltip = visible
    ? "Teammates can see which trace you're viewing and where in it you are, to make collaboration easier. Click to stop sharing."
    : "Teammates can't see which trace you're viewing. Click to share your trace location again.";

  const dotColor = visible ? "green.solid" : "fg.subtle";

  const trigger = (
    <HStack
      as="button"
      type="button"
      onClick={toggleHidden}
      aria-pressed={hidden}
      aria-label={tooltip}
      width={showLabel ? "full" : "auto"}
      height={MENU_ITEM_HEIGHT}
      gap={3}
      paddingX={3}
      borderRadius="lg"
      cursor="pointer"
      backgroundColor="transparent"
      transition="background-color 0.15s ease-in-out"
      _hover={{ backgroundColor: "nav.bgHover" }}
    >
      <Box
        position="relative"
        flexShrink={0}
        display="flex"
        alignItems="center"
        justifyContent="center"
        width={`${ICON_SIZE}px`}
        height={`${ICON_SIZE}px`}
      >
        <Icon
          size={ICON_SIZE}
          color="var(--chakra-colors-nav-fg-muted)"
        />
        <StatusDot color={dotColor} pulse={visible} corner />
      </Box>
      {showLabel && (
        <>
          <Text
            fontSize="14px"
            fontWeight="normal"
            color="nav.fg"
            whiteSpace="nowrap"
            flex={1}
            overflow="hidden"
            textOverflow="ellipsis"
            textAlign="left"
          >
            {label}
          </Text>
          <StatusDot color={dotColor} pulse={visible} />
        </>
      )}
    </HStack>
  );

  return (
    <Tooltip
      content={tooltip}
      positioning={{ placement: showLabel ? "top" : "right" }}
      openDelay={250}
    >
      <Box width={showLabel ? "full" : "auto"}>{trigger}</Box>
    </Tooltip>
  );
};

interface StatusDotProps {
  color: string;
  pulse: boolean;
  /**
   * When true the dot is rendered as a small overlay anchored to the
   * bottom-right corner of its parent (used in the collapsed icon
   * variant). Otherwise it flows inline at the row's trailing edge.
   */
  corner?: boolean;
}

function StatusDot({ color, pulse, corner = false }: StatusDotProps) {
  const size = corner ? "7px" : "8px";

  const dot = (
    <Box
      width={size}
      height={size}
      borderRadius="full"
      background={color}
      borderWidth="1.5px"
      borderColor="bg.surface"
      flexShrink={0}
    />
  );

  if (!pulse) {
    if (!corner) return dot;
    return (
      <Box
        position="absolute"
        bottom="-2px"
        right="-2px"
        pointerEvents="none"
      >
        {dot}
      </Box>
    );
  }

  const ring = (
    <Box
      position="absolute"
      inset={0}
      borderRadius="full"
      borderWidth="1.5px"
      borderColor={color}
      pointerEvents="none"
      css={{
        animation: "presenceToggleRing 1.8s ease-out infinite",
        "@keyframes presenceToggleRing": {
          "0%": { transform: "scale(0.8)", opacity: 0.7 },
          "70%": { transform: "scale(1.9)", opacity: 0 },
          "100%": { transform: "scale(1.9)", opacity: 0 },
        },
      }}
    />
  );

  const wrapped = (
    <Box position="relative" width={size} height={size} flexShrink={0}>
      {ring}
      {dot}
    </Box>
  );

  if (!corner) return wrapped;

  return (
    <Box
      position="absolute"
      bottom="-2px"
      right="-2px"
      pointerEvents="none"
    >
      {wrapped}
    </Box>
  );
}
