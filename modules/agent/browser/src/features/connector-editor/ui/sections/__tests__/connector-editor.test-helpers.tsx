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
  connectorState.secrets = [];
  connectorState.datasets = [];
}

export function renderConnectorDrawer(props: Partial<AgentConnectorEditorDrawerProps> = {}) {
  const host = new ConnectorTestHost();
  renderWithDesignSystem(
    <AgentManagementHostProvider value={host}>
      <AgentConnectorEditorDrawer open={true} {...props} />
    </AgentManagementHostProvider>,
  );
  return host;
}
