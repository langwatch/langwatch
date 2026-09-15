import {
  AgentCodeEditorDrawer as CodeEditor,
  AgentTestPanel,
} from "@langwatch/agent-web/agent-editors";
import { agentApi, type AgentBrowser } from "@langwatch/agent-web/agent-client";
import { fieldSchema } from "@langwatch/agent-contract";
import { CodeBlockEditor } from "@langwatch/workflow-web/surfaces/code-block-editor";
import { CodeEditorModal } from "@langwatch/workflow-web/surfaces/code-editor-transport";
import { CODE_OUTPUT_TYPES, OutputsSection } from "@langwatch/prompt-web/surfaces/outputs-section";
import {
  VariablesSection,
  type AvailableSource,
  type FieldMapping,
} from "@langwatch/prompt-web/surfaces/variables";
import { ScenarioInputMappingSection } from "@langwatch/scenario-web/scenario-mappings";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { describeError, showErrorToast } from "@langwatch/ui-host/errors";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";

export type AgentCodeEditorDrawerProps = {
  open?: boolean;
  agentId?: string;
  onClose?: () => void;
  onSave?: (agent: AgentBrowser) => void;
  availableSources?: AvailableSource[];
  inputMappings?: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
};

export function AgentCodeEditorDrawer(props: AgentCodeEditorDrawerProps) {
  const { session } = useUiCapabilities();
  const projectId = session.activeScope().projectId ?? void 0;
  const { closeDrawer, canGoBack, goBack, drawerOpen } = useDrawer();
  const params = useDrawerParams();
  const agentId = props.agentId ?? params.agentId;
  const open = props.open ?? drawerOpen("agentCodeEditor");
  const utils = agentApi.useUtils();
  const agent = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId: projectId ?? "" },
    { enabled: Boolean(agentId && projectId && open) },
  );
  const create = agentApi.agents.create.useMutation();
  const update = agentApi.agents.update.useMutation();

  return (
    <CodeEditor
      key={`${projectId}:${agentId ?? "new"}`}
      open={open}
      agentId={agentId}
      agent={agent.data}
      projectId={projectId}
      isLoading={agent.isLoading}
      errorMessage={
        agent.error
          ? describeError({ error: agent.error, fallbackTitle: "Couldn't load agent" })
          : void 0
      }
      isSaving={create.isPending || update.isPending}
      onClose={props.onClose ?? closeDrawer}
      onGoBack={canGoBack ? goBack : void 0}
      onSave={props.onSave}
      onCreate={async (input) => {
        const created = await create.mutateAsync({ ...input, type: "code" });
        void utils.agents.getAll.invalidate({ projectId: input.projectId });
        return created;
      }}
      onUpdate={async (input) => {
        const updated = await update.mutateAsync(input);
        void utils.agents.getAll.invalidate({ projectId: input.projectId });
        void utils.agents.getById.invalidate({ id: input.id, projectId: input.projectId });
        return updated;
      }}
      onError={(error) =>
        showErrorToast({
          error,
          fallbackTitle: agentId ? "Couldn't save agent" : "Couldn't create agent",
        })
      }
      onInputMappingsChange={props.onInputMappingsChange}
      renderCodeEditor={({ code, onChange, onExpand }) => (
        <CodeBlockEditor
          code={code}
          onChange={onChange}
          language="python"
          externalModal
          onEditClick={onExpand}
        />
      )}
      renderCodeModal={({ code, onChange, open, onClose }) => (
        <CodeEditorModal code={code} setCode={onChange} open={open} onClose={onClose} />
      )}
      renderInputs={({ inputs, onChange, onMappingChange }) => (
        <VariablesSection
          variables={inputs}
          onChange={onChange}
          showMappings={Boolean(props.availableSources?.length)}
          availableSources={props.availableSources}
          mappings={props.inputMappings}
          onMappingChange={onMappingChange}
          canAddRemove
          readOnly={false}
          title="Inputs"
          isMappingDisabled={!props.availableSources?.length}
        />
      )}
      renderOutputs={({ outputs, onChange }) => (
        <OutputsSection
          outputs={outputs}
          onChange={(outputs) => onChange(fieldSchema.array().parse(outputs))}
          canAddRemove
          readOnly={false}
          title="Outputs"
          availableTypes={CODE_OUTPUT_TYPES}
        />
      )}
      renderMappings={(input) => <ScenarioInputMappingSection {...input} />}
      renderTestPanel={(input) => <AgentTestPanel {...input} />}
    />
  );
}
