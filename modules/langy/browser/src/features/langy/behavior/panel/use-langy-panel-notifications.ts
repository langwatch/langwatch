import { useMemo } from "react";

import { useLangyNotificationPreference, useLangyNotifier } from "../use-langy-notifications.ts";
import type { useLangyLocalWaits } from "./use-langy-local-waits.ts";

type LocalWaits = ReturnType<typeof useLangyLocalWaits>;

/**
 * Browser notifications for the open conversation (specs/langy/langy-notifications.feature): a
 * long turn that finishes, a card that waits on the person, or Langy's own `notify` call, sent
 * only while the person is away from the tab and asked for them.
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
    decisionKeysReady: waits.workspaceFetched,
    enabled: preference.choice === "enabled",
    permission: preference.permission,
  });
}
