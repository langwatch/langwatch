/**
 * Presence-broadcast toggle, drawn as a `Menu.Item` flush with API Keys / Settings / Logout.
 * States its own disabled treatment when presence is off at the organization or project.
 */

import { Box, HStack, Icon, Menu, Text } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Eye, EyeOff } from "lucide-react";

import {
  resolvePresenceAvailability,
  usePresencePreferencesStore,
} from "@langwatch/presence-web/surfaces/presence-state";

/**
 * The two switches the row reads, in the shape the application's own workspace
 * graph carries them. Absent means never read, which leaves presence on.
 */
export interface PresenceMenuItemProps {
  organizationPresenceEnabled?: boolean | undefined;
  projectPresenceEnabled?: boolean | undefined;
}

export function PresenceMenuItem({
  organizationPresenceEnabled,
  projectPresenceEnabled,
}: PresenceMenuItemProps) {
  const { enabled, disabledAt } = resolvePresenceAvailability({
    organizationPresenceEnabled,
    projectPresenceEnabled,
  });
  const hidden = usePresencePreferencesStore((s) => s.hidden);
  const toggleHidden = usePresencePreferencesStore((s) => s.toggleHidden);

  const visible = enabled && !hidden;
  const StatusIcon = visible ? Eye : EyeOff;

  const enabledLabel = visible ? "Sharing presence" : "Presence hidden";
  const label = enabled ? enabledLabel : "Presence off";

  const disabledTooltip =
    disabledAt === "organization"
      ? "Live presence has been disabled at the organization level. Ask an admin to enable it in Organization Settings."
      : "Live presence has been disabled for this project. Ask an admin to enable it in Project Settings.";
  const enabledTooltip = visible
    ? "Teammates can see your avatar and which view you're in. Click to hide your presence."
    : "Your presence is hidden from teammates. Click to share it again.";
  const tooltip = enabled ? enabledTooltip : disabledTooltip;

  return (
    <Tooltip content={tooltip} positioning={{ placement: "left" }} openDelay={250}>
      <Menu.Item
        value="presence"
        // The row stays open after a click so the reader sees the dot and the
        // label flip; they dismiss the menu themselves.
        closeOnSelect={false}
        // onClick, not onSelect: Chakra v3's Menu.Item exposes the click
        // handler as onClick, and onSelect is the DOM text-selection event.
        onClick={enabled ? toggleHidden : void 0}
        disabled={!enabled}
        opacity={enabled ? 1 : 0.55}
        cursor={enabled ? "pointer" : "not-allowed"}
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
            {enabled && (
              <Box
                position="absolute"
                bottom="-2px"
                right="-2px"
                width="7px"
                height="7px"
                borderRadius="full"
                background={visible ? "green.solid" : "fg.subtle"}
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
