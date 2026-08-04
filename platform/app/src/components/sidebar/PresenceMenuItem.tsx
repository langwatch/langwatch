import { Box, HStack, Icon, Menu, Text } from "@chakra-ui/react";
import { LuEye, LuEyeOff } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { usePresenceFeatureEnabled } from "~/features/presence/hooks/usePresenceFeatureEnabled";
import { usePresencePreferencesStore } from "~/features/presence/stores/presencePreferencesStore";

/**
 * Presence-broadcast toggle rendered inside the avatar dropdown.
 * Shaped as a `Menu.Item` so it sits flush with API Keys / Settings /
 * Logout. The control is mounted only on surfaces where
 * presence is meaningful (currently the traces lens), so the row also
 * renders its own disabled treatment when the feature is off at the
 * org or project level.
 */
export function PresenceMenuItem() {
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  const toggleHidden = usePresencePreferencesStore((s) => s.toggleHidden);
  const { enabled: featureEnabled, disabledAt } = usePresenceFeatureEnabled();

  const visible = featureEnabled && !hidden;
  const StatusIcon = visible ? LuEye : LuEyeOff;

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
      ? "Teammates can see your avatar and which view you're in. Click to hide your presence."
      : "Your presence is hidden from teammates. Click to share it again.";

  const dotColor = !featureEnabled
    ? "fg.subtle"
    : visible
      ? "green.solid"
      : "fg.subtle";

  return (
    <Tooltip
      content={tooltip}
      positioning={{ placement: "left" }}
      openDelay={250}
    >
      <Menu.Item
        value="presence"
        // Keep the row open after a click so the operator can see the
        // dot/label flip without the dropdown collapsing on them. They
        // dismiss manually via outside-click or Escape.
        closeOnSelect={false}
        // onClick (not onSelect): Chakra v3 Menu.Item exposes the click
        // handler as onClick; onSelect is the DOM text-selection event, so it
        // never fired - the toggle was a dead click with no visual feedback.
        onClick={featureEnabled ? toggleHidden : undefined}
        disabled={!featureEnabled}
        opacity={featureEnabled ? 1 : 0.55}
        cursor={featureEnabled ? "pointer" : "not-allowed"}
      >
        <HStack gap={2} flex={1}>
          <Box
            position="relative"
            flexShrink={0}
            display="flex"
            alignItems="center"
            justifyContent="center"
            width="16px"
            height="16px"
          >
            <Icon as={StatusIcon} boxSize={4} color="fg.muted" />
            {featureEnabled && (
              <Box
                position="absolute"
                bottom="-2px"
                right="-2px"
                width="7px"
                height="7px"
                borderRadius="full"
                background={dotColor}
                borderWidth="1.5px"
                borderColor="bg.surface"
              />
            )}
          </Box>
          <Text textStyle="sm" flex={1}>
            {label}
          </Text>
        </HStack>
      </Menu.Item>
    </Tooltip>
  );
}
