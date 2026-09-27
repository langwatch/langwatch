/**
 * The drawers the address bar opens, each wired to what it reads so it needs no caller
 * (main's #3193; ARCHITECTURE.md: drawers are URL-routed singletons that navigate).
 */
import { CopyButton } from "@langwatch/design-system/copy-button";

import { useConnectedAgentDetail } from "../../behavior/use-connected-agent-detail.ts";
import { useRoutedDrawer } from "../../behavior/use-routed-drawer.ts";
import { ConnectFromCodeDrawer } from "./connect-from-code-drawer.tsx";
import { ConnectedAgentDrawer } from "./connected-agent-drawer.tsx";

export function RoutedConnectedAgentDrawer({ agentId }: { agentId?: string }) {
  const { close } = useRoutedDrawer();
  const detail = useConnectedAgentDetail(agentId);
  return (
    <ConnectedAgentDrawer
      agent={detail.agent ?? null}
      isLoading={detail.isLoading}
      projectId={detail.projectId}
      onClose={close}
    />
  );
}

export function RoutedConnectFromCodeDrawer() {
  const { close, goBack } = useRoutedDrawer();
  return (
    <ConnectFromCodeDrawer
      open
      onClose={close}
      {...(goBack ? { onGoBack: goBack } : {})}
      renderCopyButton={({ value, label }) => (
        <CopyButton value={value} label={label} aria-label={`Copy ${label.toLowerCase()}`} />
      )}
    />
  );
}
