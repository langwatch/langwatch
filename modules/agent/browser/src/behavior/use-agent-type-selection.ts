import { useDrawer } from "@langwatch/browser-host/drawer";

import { newAgentDrawerFor, type NewAgentType } from "../model/new-agent-drawer.ts";

/** A caller that takes the choice keeps it; opened by address, the selector navigates itself. */
export function useAgentTypeSelection({
  onSelect,
  onClose,
  onConnectFromCode,
}: {
  onSelect?: (type: NewAgentType) => void;
  onClose?: () => void;
  onConnectFromCode?: () => void;
}) {
  const { openDrawer, closeDrawer } = useDrawer();
  return {
    close: onClose ?? closeDrawer,
    select: onSelect ?? ((type: NewAgentType) => openDrawer(newAgentDrawerFor(type))),
    connectFromCode: onConnectFromCode ?? (() => openDrawer("agentConnectFromCode")),
  };
}
