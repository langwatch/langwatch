import { useDrawer } from "@langwatch/browser-host/drawer";

import { VOICE_AGENTS_FLAG_KEY } from "../features/voice-editor/model/voice-talk.ts";
import { useAgentManagementHost } from "../model/agent-management-host.ts";
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
  const host = useAgentManagementHost();
  return {
    voiceEnabled: host.isFeatureEnabled(VOICE_AGENTS_FLAG_KEY),
    close: onClose ?? closeDrawer,
    select: onSelect ?? ((type: NewAgentType) => openDrawer(newAgentDrawerFor(type))),
    connectFromCode: onConnectFromCode ?? (() => openDrawer("agentConnectFromCode")),
  };
}
