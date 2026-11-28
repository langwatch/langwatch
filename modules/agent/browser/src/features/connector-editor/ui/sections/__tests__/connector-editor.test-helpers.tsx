/** Renders the connector editor under the voice editor's test host, with the connector flag. */

import type { ReleaseFlagToken } from "@langwatch/browser-host/declarations";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { vi } from "vitest";

import { AgentManagementHostProvider } from "../../../../../model/agent-management-host.ts";
import {
  resetVoiceState,
  VoiceTestHost,
} from "../../../../voice-editor/ui/sections/__tests__/voice-editor.test-helpers.tsx";
import type { AgentConnectorEditorDrawerProps } from "../../../behavior/use-connector-agent-editor.ts";
import { AgentConnectorEditorDrawer } from "../agent-connector-editor-drawer.tsx";
import { connectorState } from "./connector-editor-doubles.test-helpers.tsx";

export class ConnectorTestHost extends VoiceTestHost {
  override isFeatureEnabled(flag: ReleaseFlagToken): boolean {
    if (flag.name === "release_scenario_connector_steps") return connectorState.flagOn;
    return super.isFeatureEnabled(flag);
  }
}

export function resetConnectorState(): void {
  resetVoiceState();
  vi.clearAllMocks();
  connectorState.flagOn = true;
  connectorState.agentById = void 0;
  connectorState.agentByIdError = void 0;
  connectorState.savePending = false;
  connectorState.secrets = [];
  connectorState.datasets = [];
}

/** Renders the drawer open; `rerender` changes its props, as the routed drawer does. */
export function renderConnectorDrawer(props: Partial<AgentConnectorEditorDrawerProps> = {}) {
  const host = new ConnectorTestHost();
  const drawer = (next: Partial<AgentConnectorEditorDrawerProps>) => (
    <AgentManagementHostProvider value={host}>
      <AgentConnectorEditorDrawer open={true} {...next} />
    </AgentManagementHostProvider>
  );
  const rendered = renderWithDesignSystem(drawer(props));
  return {
    host,
    rerender: (next: Partial<AgentConnectorEditorDrawerProps>) =>
      rendered.rerender(drawer({ ...props, ...next })),
  };
}
