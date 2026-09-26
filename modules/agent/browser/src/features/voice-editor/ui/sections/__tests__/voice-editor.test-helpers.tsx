/** Renders the voice editor under a test host for agent's own port. */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

import type { AgentClient } from "../../../../../model/agent-client.ts";
import {
  AgentManagementHostProvider,
  type AgentCopyTarget,
  type AgentFailureNotice,
  type AgentHostProject,
  type AgentManagementHost,
  type AgentRouteReading,
} from "../../../../../model/agent-management-host.ts";
import type { AgentVoiceEditorDrawerProps } from "../../../behavior/use-voice-agent-editor.ts";
import { AgentVoiceEditorDrawer } from "../agent-voice-editor-drawer.tsx";
import { voiceState } from "./voice-editor-doubles.test-helpers.tsx";

const unused = (name: string) => () =>
  Promise.reject(new Error(`VoiceTestHost.agents().${name} is not used by these tests`));

const unusedAgents: AgentClient = {
  getById: unused("getById"),
  create: unused("create"),
  update: unused("update"),
  relatedEntities: unused("relatedEntities"),
  cascadeArchive: unused("cascadeArchive"),
  archive: unused("archive"),
  getCopies: unused("getCopies"),
  copy: unused("copy"),
  pushToCopies: unused("pushToCopies"),
  syncFromSource: unused("syncFromSource"),
  getHistory: unused("getHistory"),
};

export class VoiceTestHost implements AgentManagementHost {
  readonly failures: AgentFailureNotice[] = [];
  readonly editorsOpened: Parameters<AgentManagementHost["openAgentEditor"]>[0][] = [];
  project(): AgentHostProject {
    return { id: "test-project", slug: "test-project" };
  }
  isFeatureEnabled(flag: string): boolean {
    return flag === "release_voice_agents_enabled" && voiceState.flagOn;
  }
  failed(failure: AgentFailureNotice): void {
    this.failures.push(failure);
  }
  describeFailure(failure: AgentFailureNotice): string {
    return failure.fallbackTitle;
  }
  agents(): AgentClient {
    return unusedAgents;
  }
  copyTargets(): readonly AgentCopyTarget[] {
    return [];
  }
  route(): AgentRouteReading {
    return { params: {}, query: {} };
  }
  setQuery(): void {
    throw new Error("VoiceTestHost.setQuery is not used by the voice editor");
  }
  navigate(): void {
    throw new Error("VoiceTestHost.navigate is not used by the voice editor");
  }
  succeeded(): void {
    throw new Error("VoiceTestHost.succeeded is not used by the voice editor");
  }
  openAgentEditor(input: Parameters<AgentManagementHost["openAgentEditor"]>[0]): void {
    this.editorsOpened.push(input);
  }
  openConnectedAgent(): void {
    throw new Error("VoiceTestHost.openConnectedAgent is not used by the voice editor");
  }
  openTestRun(): void {
    throw new Error("VoiceTestHost.openTestRun is not used by the voice editor");
  }
  refreshAgentLimit(): Promise<void> {
    return Promise.resolve();
  }
}

export function resetVoiceState(): void {
  vi.clearAllMocks();
  voiceState.flagOn = true;
  voiceState.agentById = void 0;
  voiceState.providers = [];
  sessionStorage.clear();
}

export function renderVoiceDrawer(props: Partial<AgentVoiceEditorDrawerProps> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AgentManagementHostProvider value={new VoiceTestHost()}>
        <AgentVoiceEditorDrawer open={true} {...props} />
      </AgentManagementHostProvider>
    </ChakraProvider>,
  );
}

/** The transport select's option by its label, once the form has drawn. */
export async function phoneOption(name: string | RegExp) {
  await screen.findByTestId("voice-agent-transport-select");
  return screen.getByRole<HTMLOptionElement>("option", { name });
}
