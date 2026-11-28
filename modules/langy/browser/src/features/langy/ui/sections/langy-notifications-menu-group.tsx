import { Menu } from "@langwatch/design-system/menu";
/**
 * The Notifications section of Langy's menu: turn Langy's browser
 * notifications on or off, and see when the browser has blocked them.
 * Spec: specs/langy/langy-notifications.feature
 */
import { Box, HStack, Text } from "@langwatch/design-system/primitives";
import { Bell, BellOff, Check, RotateCw } from "lucide-react";

import {
  langyPushSetupProblem,
  type LangyPushSetupFailure,
} from "../../../../model/langy-notifications.ts";
import { useLangyNotificationPreference } from "../../behavior/use-langy-notifications.ts";

export const LANGY_NOTIFICATIONS_MENU_LABEL = "Notifications";
export const LANGY_NOTIFICATIONS_MENU_HINT =
  "When Langy finishes long work or needs you while you are on another tab.";
export const LANGY_NOTIFICATIONS_MENU_BLOCKED = "Blocked by your browser";
export const LANGY_NOTIFICATIONS_MENU_BLOCKED_HINT =
  "Click the icon beside the address, allow notifications for this site, then come back to this tab.";
export const LANGY_NOTIFICATIONS_MENU_UNSUPPORTED = "Not supported in this browser";
export const LANGY_NOTIFICATIONS_MENU_RETRY = "Try setting up again";

function menuHint({
  blocked,
  failure,
}: {
  blocked: boolean;
  failure: LangyPushSetupFailure | null;
}) {
  if (blocked) return LANGY_NOTIFICATIONS_MENU_BLOCKED_HINT;
  if (failure) return langyPushSetupProblem(failure).line;
  return LANGY_NOTIFICATIONS_MENU_HINT;
}

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
  const failure = on ? notifications.pushSetupFailure : null;
  const retryable = failure !== null && langyPushSetupProblem(failure).retryable;

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
          <Box paddingTop="0.5">
            {blocked || unsupported ? <BellOff size={14} /> : <Bell size={14} />}
          </Box>
          <Box flex={1}>
            <Text textStyle="sm">{menuLabel({ blocked, unsupported })}</Text>
            <Text textStyle="xs" color="fg.muted" whiteSpace="normal" maxWidth="20rem">
              {menuHint({ blocked, failure })}
            </Text>
          </Box>
          {on ? (
            <Box color="orange.fg" paddingTop="0.5" data-testid="langy-notifications-on">
              <Check size={13} />
            </Box>
          ) : null}
        </HStack>
      </Menu.Item>
      {retryable ? (
        <Menu.Item
          value="notifications-retry"
          closeOnSelect={false}
          onClick={() => void notifications.retryPushSetup()}
        >
          <HStack gap={2.5} width="full">
            <RotateCw size={14} />
            <Text textStyle="sm">{LANGY_NOTIFICATIONS_MENU_RETRY}</Text>
          </HStack>
        </Menu.Item>
      ) : null}
    </Menu.ItemGroup>
  );
}
