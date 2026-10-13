import { useDrawer } from "@langwatch/browser-host/drawer";
import { useCallback, useState } from "react";

import { agentApi } from "../../../behavior/agent-api.ts";
import type { AgentBrowser } from "../../../model/agent-client.ts";
import { useAgentManagementHost } from "../../../model/agent-management-host.ts";
import {
  hasElevenLabsKeyIn,
  hasTwilioKeyIn,
  type ProviderRowReading,
} from "../model/voice-provider-keys.ts";
import { VOICE_AGENTS_FLAG_KEY } from "../model/voice-talk.ts";
import { useSaveVoiceAgent } from "./use-save-voice-agent.ts";
import { useVoiceFormState } from "./use-voice-form-state.ts";
import { clearVoiceDraft } from "./voice-draft-store.ts";

/** What the routed drawer receives: its address-bar params plus the flow callbacks. */
export type AgentVoiceEditorDrawerProps = {
  open?: boolean | string;
  agentId?: string;
  /** `?drawer.talk=1` opens straight onto the call panel (#23). */
  talk?: string;
  onClose?: () => void;
  onSave?: (agent: AgentBrowser) => void;
};

const NO_PROVIDER_ROWS: readonly ProviderRowReading[] = [];

export function useVoiceAgentEditor(props: AgentVoiceEditorDrawerProps) {
  const host = useAgentManagementHost();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const project = host.project();
  const projectId = project?.id ?? "";
  const agentId = props.agentId;
  const isOpen = props.open !== false && props.open !== void 0;
  const isCreating = !agentId;
  const onClose = props.onClose ?? closeDrawer;
  const [isTalkOpen, setIsTalkOpen] = useState(props.talk === "1");
  const [createdAgentRowId, setCreatedAgentRowId] = useState<string>();

  const agentQuery = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: Boolean(agentId) && Boolean(projectId) && isOpen },
  );
  const providersQuery = agentApi.modelProvider.listAllForProjectForFrontend.useQuery(
    { projectId },
    { enabled: Boolean(projectId) && isOpen },
  );
  const { form, change } = useVoiceFormState({
    agent: agentQuery.data,
    agentId,
    isCreating,
    isOpen,
    projectId,
  });
  const saving = useSaveVoiceAgent({
    projectId,
    agentId,
    createdAgentRowId,
    form,
    onSave: props.onSave,
    onClose,
    onFailure: (failure) => host.failed(failure),
  });
  const close = useCallback(() => {
    if (projectId) clearVoiceDraft(projectId);
    onClose();
  }, [projectId, onClose]);
  const agentCreated = useCallback(
    (rowId: string) => {
      setCreatedAgentRowId(rowId);
      saving.refreshAgents();
    },
    [saving],
  );
  const rows = providersQuery.data ?? NO_PROVIDER_ROWS;

  return {
    isEnabled: host.isFeatureEnabled(VOICE_AGENTS_FLAG_KEY),
    project,
    projectId,
    agentId,
    isOpen,
    canGoBack,
    goBack,
    form,
    change,
    hasElevenLabsKey: hasElevenLabsKeyIn(rows),
    hasTwilioKey: hasTwilioKeyIn(rows),
    isLoading: Boolean(agentId) && agentQuery.isLoading,
    isTalkOpen,
    openTalk: () => setIsTalkOpen(true),
    closeTalk: () => setIsTalkOpen(false),
    createdAgentRowId,
    agentCreated,
    close,
    ...saving,
  };
}

export type VoiceAgentEditor = ReturnType<typeof useVoiceAgentEditor>;
