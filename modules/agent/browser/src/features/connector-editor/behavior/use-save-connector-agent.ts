import { useCallback, useEffect, useRef, useState } from "react";

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

/**
 * Create or update from the form, once the connector schema accepts what it would store. A save
 * that lands after its drawer session ended (closed, unmounted or on another agent) still
 * refreshes the agent, but never calls `onSave` or `onClose`, which now belong to someone else.
 */
export function useSaveConnectorAgent(input: {
  projectId: string;
  agentId: string | undefined;
  isOpen: boolean;
  form: ConnectorForm;
  onSave: ((agent: AgentBrowser) => void) | undefined;
  onClose: () => void;
  onFailure: (failure: AgentFailureNotice) => void;
}) {
  const { projectId, agentId, isOpen, form, onSave, onClose, onFailure } = input;
  const refreshSavedAgent = useRefreshSavedAgent({ projectId });
  const create = agentApi.agents.create.useMutation();
  const update = agentApi.agents.update.useMutation();
  // Save is never disabled by validity: a failed submit reveals the inline errors.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const check = checkConnectorForm(form);
  const session = useRef(0);
  useEffect(
    () => () => {
      session.current += 1;
    },
    [agentId, isOpen],
  );

  const save = useCallback(() => {
    setHasAttemptedSubmit(true);
    if (!projectId || !check.ok) return;
    const startedIn = session.current;
    const saved = (agent: AgentBrowser) => {
      void refreshSavedAgent({ agentId: agent.id });
      if (session.current !== startedIn) return;
      onSave?.(agent);
      onClose();
    };
    const values = { projectId, name: form.name.trim(), config: check.config };
    const failed = (fallbackTitle: string) => (error: unknown) =>
      onFailure({ error, fallbackTitle });
    if (agentId) {
      void update
        .mutateAsync({ ...values, id: agentId })
        .then(saved, failed("Couldn't save agent"));
    } else {
      void create
        .mutateAsync({ ...values, type: "connector" })
        .then(saved, failed("Couldn't create agent"));
    }
  }, [
    projectId,
    check,
    form.name,
    agentId,
    update,
    create,
    refreshSavedAgent,
    onSave,
    onClose,
    onFailure,
  ]);

  return {
    save,
    errors: hasAttemptedSubmit && !check.ok ? check.errors : NO_ERRORS,
    isSaving: create.isPending || update.isPending,
  };
}
