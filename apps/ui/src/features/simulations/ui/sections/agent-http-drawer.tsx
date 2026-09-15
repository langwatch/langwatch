import { AgentHttpEditorDrawer as HttpEditor } from "@langwatch/agent-web/agent-http-editor";
import { AgentTestPanel } from "@langwatch/agent-web/agent-editors";
import { agentApi, type AgentBrowser } from "@langwatch/agent-web/agent-client";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { ScenarioInputMappingSection } from "@langwatch/scenario-web/scenario-mappings";
import { scenarioApi } from "@langwatch/scenario-web/simulations";
import {
  VariablesSection,
  type AvailableSource,
  type FieldMapping,
} from "@langwatch/prompt-web/surfaces/variables";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { showErrorToast } from "@langwatch/ui-host/errors";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";
import { explainExecutionStateError } from "@langwatch/workflow-web/surfaces/execution-state-error";

const defaultScenarioMappings = computeBestMatchMappings({
  inputs: [{ identifier: "threadId" }, { identifier: "input" }, { identifier: "messages" }],
});

export interface AgentHttpEditorDrawerProps {
  open?: boolean;
  onClose?: () => void;
  onSave?: (agent: AgentBrowser) => void;
  agentId?: string;
  availableSources?: AvailableSource[];
  inputMappings?: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
}

export function AgentHttpEditorDrawer(props: AgentHttpEditorDrawerProps) {
  const projectId = useUiCapabilities().session.activeScope().projectId ?? void 0;
  const drawer = useDrawer();
  const params = useDrawerParams();
  const agentId = props.agentId ?? params.agentId;
  const open = props.open ?? drawer.drawerOpen("agentHttpEditor");
  const utils = agentApi.useUtils();
  const createAgent = agentApi.agents.create.useMutation();
  const updateAgent = agentApi.agents.update.useMutation();
  const executeHttp = scenarioApi.httpProxy.execute.useMutation();
  const agent = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId: projectId ?? "" },
    { enabled: Boolean(agentId && projectId && open) },
  );

  return (
    <HttpEditor
      key={`${projectId}:${agentId ?? "new"}`}
      open={open}
      agentId={agentId}
      agent={agent.data}
      projectId={projectId}
      isLoadingAgent={agent.isLoading}
      isSaving={createAgent.isPending || updateAgent.isPending}
      onClose={props.onClose ?? drawer.closeDrawer}
      onGoBack={drawer.canGoBack ? drawer.goBack : void 0}
      onSave={props.onSave}
      onCreate={async (input) => {
        const created = await createAgent.mutateAsync({ ...input, type: "http" });
        void utils.agents.getAll.invalidate({ projectId: input.projectId });
        return created;
      }}
      onUpdate={async (input) => {
        const updated = await updateAgent.mutateAsync(input);
        void utils.agents.getAll.invalidate({ projectId: input.projectId });
        void utils.agents.getById.invalidate({ id: updated.id, projectId: input.projectId });
        return updated;
      }}
      onTest={async (input) => {
        if (!projectId) return { success: false, error: "No project selected" };

        return executeHttp
          .mutateAsync({
            ...input,
            projectId,
            headers: input.headers.map(({ key, value }) => ({ key, value })),
          })
          .catch((error: unknown) => ({
            success: false,
            error: error instanceof Error ? error.message : "Test request failed",
          }));
      }}
      renderScenarioMappings={(mapping) => <ScenarioInputMappingSection {...mapping} />}
      renderVariables={(variables) => (
        <VariablesSection
          title="Input Variables"
          variables={variables.variables}
          onChange={variables.onChange}
          showMappings
          availableSources={props.availableSources}
          mappings={variables.mappings}
          onMappingChange={variables.onMappingChange}
          canAddRemove
          readOnly={false}
          lockedVariables={variables.lockedVariableIds}
          missingMappingIds={variables.missingMappingIds}
          showMissingMappingsError={false}
          optionalHighlighting
        />
      )}
      renderTestPanel={(target) => <AgentTestPanel {...target} />}
      explainTestError={({ errorCode, error }) =>
        explainExecutionStateError({
          state: { error_type: errorCode, error },
          fallbackTitle: "The request failed",
        })
      }
      onSaveError={showErrorToast}
      defaultScenarioMappings={defaultScenarioMappings}
      showVariables={(props.availableSources?.length ?? 0) > 0}
      inputMappings={props.inputMappings}
      onInputMappingsChange={props.onInputMappingsChange}
    />
  );
}
