import { useMemo } from "react";

import { langyTabNotifies } from "../../../../model/langy-notifications.ts";
import {
  langyDecisionKeysReady,
  useLangyNotificationPreference,
  useLangyNotifier,
} from "../use-langy-notifications.ts";
import type { useLangyLocalWaits } from "./use-langy-local-waits.ts";

type LocalWaits = ReturnType<typeof useLangyLocalWaits>;

/**
 * The open tab's fallback notifications for the open conversation, only while the person is
 * away and this browser cannot hold a push subscription. Spec: langy-notifications.feature
 */
export function useLangyPanelNotifications({
  conversationId,
  conversationTitle,
  status,
  messages,
  waits,
  liveCodeAccessCallId,
}: {
  conversationId: string | null;
  conversationTitle: string | null;
  status: string;
  messages: readonly { role?: string; parts?: readonly unknown[] }[];
  waits: LocalWaits;
  liveCodeAccessCallId: string | null;
}): void {
  const preference = useLangyNotificationPreference();
  const { permissionCards, questionWaits, terminalConnected } = waits;
  const decisionKeys = useMemo(
    () => [
      ...permissionCards.filter((card) => card.status === "pending").map((card) => card.waitId),
      ...[...questionWaits.values()]
        .filter((wait) => wait.status === "pending")
        .map((wait) => wait.waitId),
      ...(liveCodeAccessCallId && !terminalConnected
        ? [`code_access:${liveCodeAccessCallId}`]
        : []),
    ],
    [permissionCards, questionWaits, liveCodeAccessCallId, terminalConnected],
  );
  useLangyNotifier({
    conversationId,
    conversationTitle,
    status,
    messages,
    decisionKeys,
    decisionKeysReady: langyDecisionKeysReady(waits),
    enabled: langyTabNotifies(preference),
    permission: preference.permission,
  });
}
