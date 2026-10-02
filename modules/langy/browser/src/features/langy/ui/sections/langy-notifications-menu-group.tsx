/**
 * The Notifications section of Langy's menu: turn Langy's browser
 * notifications on or off, and see when the browser has blocked them.
 * Spec: specs/langy/langy-notifications.feature
 */
import { Box, HStack, Text } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import { Bell, BellOff, Check } from "lucide-react";

import { useLangyNotificationPreference } from "../../behavior/use-langy-notifications.ts";

export const LANGY_NOTIFICATIONS_MENU_LABEL = "Notifications";
export const LANGY_NOTIFICATIONS_MENU_HINT =
  "When Langy finishes long work or needs you while you are on another tab.";
export const LANGY_NOTIFICATIONS_MENU_BLOCKED = "Blocked by your browser";
export const LANGY_NOTIFICATIONS_MENU_BLOCKED_HINT =
  "Click the icon beside the address, allow notifications for this site, then come back to this tab.";
export const LANGY_NOTIFICATIONS_MENU_UNSUPPORTED = "Not supported in this browser";

function menuLabel({ blocked, unsupported }: { blocked: boolean; unsupported: boolean }) {
  if (blocked) return LANGY_NOTIFICATIONS_MENU_BLOCKED;
  if (unsupported) return LANGY_NOTIFICATIONS_MENU_UNSUPPORTED;
  return LANGY_NOTIFICATIONS_MENU_LABEL;
}

export function LangyNotificationsMenuGroup() {
  const notifications = useLangyNotificationPreference();
  const { permission, choice } = notifications;
  const blocked = permission === "denied";
  const unsupported = permission === "unsupported";
  const on = choice === "enabled" && permission === "granted";

  const toggle = () => {
    if (on) {
      void notifications.decline();
      return;
    }
    void notifications.enable();
  };

  return (
    <Menu.ItemGroup title={LANGY_NOTIFICATIONS_MENU_LABEL}>
      <Menu.Item
        value="notifications"
        disabled={blocked || unsupported || notifications.isSaving}
        closeOnSelect={false}
        onClick={toggle}
      >
        <HStack gap={2.5} width="full" align="start">
          <Box paddingTop="2px">
            {blocked || unsupported ? <BellOff size={14} /> : <Bell size={14} />}
          </Box>
          <Box flex={1}>
            <Text textStyle="sm">{menuLabel({ blocked, unsupported })}</Text>
            <Text textStyle="xs" color="fg.muted" whiteSpace="normal">
              {blocked ? LANGY_NOTIFICATIONS_MENU_BLOCKED_HINT : LANGY_NOTIFICATIONS_MENU_HINT}
            </Text>
          </Box>
          {on ? (
            <Box color="orange.fg" paddingTop="2px" data-testid="langy-notifications-on">
              <Check size={13} />
            </Box>
          ) : null}
        </HStack>
      </Menu.Item>
    </Menu.ItemGroup>
  );
}
