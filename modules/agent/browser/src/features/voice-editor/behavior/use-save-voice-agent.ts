import { useCallback, useState } from "react";

import { agentApi } from "../../../behavior/agent-api.ts";
import type { AgentBrowser } from "../../../model/agent-client.ts";
import type { AgentFailureNotice } from "../../../model/agent-management-host.ts";
import { isVoiceFormValid, voiceConfigOf, type VoiceForm } from "../model/voice-form.ts";
import { clearVoiceDraft } from "./voice-draft-store.ts";

/**
 * Create or update from the form. Once Talk to it created the row for an
 * unsaved draft, Save updates that row instead of inserting a duplicate (#20).
 */
export function useSaveVoiceAgent(input: {
  projectId: string;
  agentId: string | undefined;
  createdAgentRowId: string | undefined;
  form: VoiceForm;
  onSave: ((agent: AgentBrowser) => void) | undefined;
  onClose: () => void;
  onFailure: (failure: AgentFailureNotice) => void;
}) {
  const { projectId, agentId, createdAgentRowId, form, onSave, onClose, onFailure } = input;
  const utils = agentApi.useUtils();
  const saved = (agent: AgentBrowser) => {
    void utils.agents.getAll.invalidate({ projectId });
    onSave?.(agent);
    onClose();
  };
  const create = agentApi.agents.create.useMutation({
    onSuccess: (agent) => {
      clearVoiceDraft(projectId);
      saved(agent);
    },
    onError: (error) => onFailure({ error, fallbackTitle: "Couldn't create agent" }),
  });
  const update = agentApi.agents.update.useMutation({
    onSuccess: (agent) => {
      void utils.agents.getById.invalidate({ id: agent.id, projectId });
      saved(agent);
    },
    onError: (error) => onFailure({ error, fallbackTitle: "Couldn't save agent" }),
  });
  // Save is never disabled by validity: a failed submit reveals the inline errors.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const savedAgentId = agentId ?? createdAgentRowId;

  const save = useCallback(() => {
    setHasAttemptedSubmit(true);
    if (!projectId || !isVoiceFormValid(form)) return;
    const values = { projectId, name: form.name.trim(), config: voiceConfigOf(form) };
    if (savedAgentId) update.mutate({ ...values, id: savedAgentId });
    else create.mutate({ ...values, type: "voice" });
  }, [projectId, form, savedAgentId, update, create]);

  return {
    save,
    hasAttemptedSubmit,
    isSaving: create.isPending || update.isPending,
    savedAgentId,
    refreshAgents: () => void utils.agents.getAll.invalidate({ projectId }),
  };
}
