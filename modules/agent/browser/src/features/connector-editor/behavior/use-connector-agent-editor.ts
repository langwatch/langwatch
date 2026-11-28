import { useDrawer } from "@langwatch/browser-host/drawer";
import { datasetClient } from "@langwatch/dataset-client";

import { agentApi } from "../../../behavior/agent-api.ts";
import type { AgentBrowser } from "../../../model/agent-client.ts";
import { useAgentManagementHost } from "../../../model/agent-management-host.ts";
import {
  SCENARIO_CONNECTOR_FLAG_KEY,
  type ConnectorDatasetOption,
} from "../model/connector-form.ts";
import { useConnectorFormState } from "./use-connector-form-state.ts";
import { useSaveConnectorAgent } from "./use-save-connector-agent.ts";

/** What the routed drawer receives: its address-bar params plus the flow callbacks. */
export type AgentConnectorEditorDrawerProps = {
  open?: boolean | string;
  agentId?: string;
  onClose?: () => void;
  onSave?: (agent: AgentBrowser) => void;
};

const NO_NAMES: readonly string[] = [];
const NO_DATASETS: readonly ConnectorDatasetOption[] = [];

export function useConnectorAgentEditor(props: AgentConnectorEditorDrawerProps) {
  const host = useAgentManagementHost();
  const { closeDrawer, canGoBack, goBack } = useDrawer();
  const projectId = host.project()?.id ?? "";
  const agentId = props.agentId;
  const isOpen = props.open !== false && props.open !== void 0;
  const isEnabled = host.isFeatureEnabled(SCENARIO_CONNECTOR_FLAG_KEY);
  const canRead = Boolean(projectId) && isOpen && isEnabled;
  const onClose = props.onClose ?? closeDrawer;

  const agentQuery = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: Boolean(agentId) && canRead },
  );
  const secretsQuery = agentApi.secrets.list.useQuery({ projectId }, { enabled: canRead });
  const datasetsQuery = datasetClient.dataset.getAll.useQuery({ projectId }, { enabled: canRead });
  const { form, change } = useConnectorFormState({ agent: agentQuery.data, agentId, isOpen });
  const saving = useSaveConnectorAgent({
    projectId,
    agentId,
    isOpen,
    form,
    onSave: props.onSave,
    onClose,
    onFailure: (failure) => host.failed(failure),
  });
  // Without the stored config the form holds starters, and saving it would overwrite the connector.
  const readError =
    agentId && agentQuery.isError
      ? {
          title: host.describeFailure({
            error: agentQuery.error,
            fallbackTitle: "Couldn't load this connector",
          }),
          description:
            "Its saved config is not shown until it loads, so nothing here can replace it.",
          onRetry: () => void agentQuery.refetch(),
        }
      : undefined;

  return {
    isEnabled,
    projectId,
    agentId,
    isOpen,
    canGoBack,
    goBack,
    close: onClose,
    form,
    change,
    projectSecretNames: secretsQuery.data?.map((secret) => secret.name) ?? NO_NAMES,
    datasets:
      datasetsQuery.data?.map((dataset) => ({ id: dataset.id, name: dataset.name })) ?? NO_DATASETS,
    isLoading: Boolean(agentId) && agentQuery.isLoading,
    readError,
    ...saving,
  };
}

export type ConnectorAgentEditor = ReturnType<typeof useConnectorAgentEditor>;
