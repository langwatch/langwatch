/**
 * The card `offer_notifications` puts up. The answer lives on the account, so the card
 * reads it rather than the tool part, and a reload shows what was chosen.
 * Spec: specs/langy/langy-notifications.feature
 */
import { Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Bell, BellOff, Check } from "lucide-react";
import type { ReactNode } from "react";

import { useLangyNotificationPreference } from "../../behavior/use-langy-notifications.ts";

export const LANGY_NOTIFICATIONS_OFFER_QUESTION =
  "It should now take around 10 minutes for me to fully set your project up. Can I notify you once it's done?";
export const LANGY_NOTIFICATIONS_ENABLE_LABEL = "Enable notifications";
export const LANGY_NOTIFICATIONS_DECLINE_LABEL = "No thanks, I'll check back";
export const LANGY_NOTIFICATIONS_ENABLED_LINE =
  "Notifications are on. I'll let you know when your project is ready.";
export const LANGY_NOTIFICATIONS_DECLINED_LINE =
  "No notifications, then. You can turn them on any time from Langy's menu.";
export const LANGY_NOTIFICATIONS_BLOCKED_LINE =
  "Your browser blocked notifications for this site. To allow them, click the icon beside the address, turn notifications on, and come back to this tab.";
export const LANGY_NOTIFICATIONS_UNSUPPORTED_LINE =
  "This browser cannot show notifications, so check back here in about 10 minutes.";

export function LangyNotificationsOfferCard() {
  const notifications = useLangyNotificationPreference();
  const { choice, permission } = notifications;

  // An answer not read yet may already be given: offering it again would ask twice.
  if (notifications.isLoading) return null;

  if (permission === "unsupported") {
    return <SettledLine icon={<BellOff size={14} />} line={LANGY_NOTIFICATIONS_UNSUPPORTED_LINE} />;
  }
  if (choice === "declined") {
    return <SettledLine icon={<BellOff size={14} />} line={LANGY_NOTIFICATIONS_DECLINED_LINE} />;
  }
  if (permission === "denied") {
    return <SettledLine icon={<BellOff size={14} />} line={LANGY_NOTIFICATIONS_BLOCKED_LINE} />;
  }
  if (choice === "enabled" && permission === "granted") {
    return <SettledLine icon={<Check size={14} />} line={LANGY_NOTIFICATIONS_ENABLED_LINE} />;
  }

  // Never answered, or turned on in a browser that has not been asked yet.
  return (
    <CardShell>
      <VStack align="stretch" gap={3}>
        <HStack align="start" gap={2}>
          <Box color="fg.muted" paddingTop="2px">
            <Bell size={14} />
          </Box>
          <Text textStyle="sm" color="fg">
            {LANGY_NOTIFICATIONS_OFFER_QUESTION}
          </Text>
        </HStack>
        <HStack gap={2} flexWrap="wrap">
          <Button
            size="xs"
            colorPalette="orange"
            loading={notifications.isSaving}
            onClick={() => void notifications.enable()}
          >
            {LANGY_NOTIFICATIONS_ENABLE_LABEL}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={notifications.isSaving}
            onClick={() => void notifications.decline()}
          >
            {LANGY_NOTIFICATIONS_DECLINE_LABEL}
          </Button>
        </HStack>
      </VStack>
    </CardShell>
  );
}

function SettledLine({ icon, line }: { icon: ReactNode; line: string }) {
  return (
    <CardShell>
      <HStack align="start" gap={2}>
        <Box color="fg.muted" paddingTop="2px">
          {icon}
        </Box>
        <Text textStyle="sm" color="fg.muted">
          {line}
        </Text>
      </HStack>
    </CardShell>
  );
}

function CardShell({ children }: { children: ReactNode }) {
  return (
    <Box
      data-testid="langy-notifications-offer-card"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      maxWidth="420px"
      background="bg.subtle"
    >
      {children}
    </Box>
  );
}
