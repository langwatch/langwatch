import { useCallback, useState } from "react";

import { agentApi } from "../../../behavior/agent-api.ts";
import { useRefreshSavedAgent } from "../../../behavior/use-refresh-saved-agent.ts";
import type { AgentBrowser } from "../../../model/agent-client.ts";
import type { AgentFailureNotice } from "../../../model/agent-management-host.ts";
import {
  checkConnectorForm,
  type ConnectorForm,
  type ConnectorFormErrors,
} from "../model/connector-form.ts";

const NO_ERRORS: ConnectorFormErrors = {};

/** Create or update from the form, once the connector schema accepts what it would store. */
export function useSaveConnectorAgent(input: {
  projectId: string;
  agentId: string | undefined;
  form: ConnectorForm;
  onSave: ((agent: AgentBrowser) => void) | undefined;
  onClose: () => void;
  onFailure: (failure: AgentFailureNotice) => void;
}) {
  const { projectId, agentId, form, onSave, onClose, onFailure } = input;
  const refreshSavedAgent = useRefreshSavedAgent({ projectId });
  const saved = (agent: AgentBrowser) => {
    void refreshSavedAgent({ agentId: agent.id });
    onSave?.(agent);
    onClose();
  };
  const create = agentApi.agents.create.useMutation({
    onSuccess: saved,
    onError: (error) => onFailure({ error, fallbackTitle: "Couldn't create agent" }),
  });
  const update = agentApi.agents.update.useMutation({
    onSuccess: saved,
    onError: (error) => onFailure({ error, fallbackTitle: "Couldn't save agent" }),
  });
  // Save is never disabled by validity: a failed submit reveals the inline errors.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const check = checkConnectorForm(form);

  const save = useCallback(() => {
    setHasAttemptedSubmit(true);
    if (!projectId || !check.ok) return;
    const values = { projectId, name: form.name.trim(), config: check.config };
    if (agentId) update.mutate({ ...values, id: agentId });
    else create.mutate({ ...values, type: "connector" });
  }, [projectId, check, form.name, agentId, update, create]);

  return {
    save,
    errors: hasAttemptedSubmit && !check.ok ? check.errors : NO_ERRORS,
    isSaving: create.isPending || update.isPending,
  };
}
