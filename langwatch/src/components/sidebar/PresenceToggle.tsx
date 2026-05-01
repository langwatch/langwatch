import { Box, chakra, Text } from "@chakra-ui/react";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { usePresenceFeatureEnabled } from "~/features/presence/hooks/usePresenceFeatureEnabled";
import { usePresencePreferencesStore } from "~/features/presence/stores/presencePreferencesStore";
import { ICON_SIZE, MENU_ITEM_HEIGHT } from "./SideMenuLink";

export type PresenceToggleProps = {
  showLabel?: boolean;
};

/**
 * Sidebar control for the user's broadcast preference: when on, peers see the
 * user's avatar/cursor and which view they're in; when off, the user goes
 * "ghost" but can still observe peers. The control becomes a non-interactive,
 * dimmed indicator when presence is disabled at the org or project level.
 */
export const PresenceToggle = ({ showLabel = true }: PresenceToggleProps) => {
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  const toggleHidden = usePresencePreferencesStore((s) => s.toggleHidden);
  const { enabled: featureEnabled, disabledAt } = usePresenceFeatureEnabled();

  const visible = featureEnabled && !hidden;
  const Icon = visible ? LuEye : LuEyeOff;

  const label = !featureEnabled
    ? "Presence off"
    : visible
      ? "Sharing presence"
      : "Presence hidden";

  const tooltip = !featureEnabled
    ? disabledAt === "organization"
      ? "Live presence has been disabled at the organization level. Ask an admin to enable it in Organization Settings."
      : "Live presence has been disabled for this project. Ask an admin to enable it in Project Settings."
    : visible
      ? "Teammates can see your avatar, cursor, and which view you're in. Click to hide your presence."
      : "Your presence is hidden from teammates. Click to share it again.";

  const dotColor = !featureEnabled
    ? "fg.subtle"
    : visible
      ? "green.solid"
      : "fg.subtle";

  const trigger = (
    <chakra.button
      type="button"
      onClick={featureEnabled ? toggleHidden : undefined}
      aria-pressed={hidden}
      aria-disabled={!featureEnabled}
      aria-label={tooltip}
      disabled={!featureEnabled}
      display="flex"
      alignItems="center"
      width={showLabel ? "full" : "auto"}
      height={MENU_ITEM_HEIGHT}
      gap={3}
      paddingX={3}
      borderRadius="lg"
      cursor={featureEnabled ? "pointer" : "not-allowed"}
      opacity={featureEnabled ? 1 : 0.55}
      backgroundColor="transparent"
      transition="background-color 0.15s ease-in-out"
      _hover={featureEnabled ? { backgroundColor: "nav.bgHover" } : undefined}
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
        {featureEnabled && (
          <StatusDot color={dotColor} pulse={visible} />
        )}
      </Box>
      {showLabel && (
        <Text
          textStyle="sm"
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
      )}
    </chakra.button>
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
}

/**
 * Small overlay anchored to the bottom-right of the parent icon — the icon
 * already conveys "watching/hidden", and the dot just signals live status.
 */
function StatusDot({ color, pulse }: StatusDotProps) {
  const size = "7px";

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

  return (
    <Box
      position="absolute"
      bottom="-2px"
      right="-2px"
      pointerEvents="none"
    >
      <Box position="relative" width={size} height={size} flexShrink={0}>
        {ring}
        {dot}
      </Box>
    </Box>
  );
}
