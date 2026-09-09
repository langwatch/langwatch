import { Link } from "@chakra-ui/react";
import { linkedWorkflowId, type Field } from "@langwatch/agent-contract";
import { agentApi, type AgentBrowser } from "@langwatch/agent-web/agent-client";
import {
  AgentWorkflowEditorDrawer as WorkflowEditor,
  AgentWorkflowTargetEditorDrawer as WorkflowTargetEditor,
} from "@langwatch/agent-web/agent-editors";
import {
  VariablesSection,
  type AvailableSource,
  type FieldMapping,
} from "@langwatch/prompt-web/surfaces/variables";
import { computeBestMatchMappings } from "@langwatch/scenario-contract";
import { ScenarioInputMappingSection } from "@langwatch/scenario-web/scenario-mappings";
import { useScenarioHost } from "@langwatch/scenario-web/screens/simulations";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";
import { toEpochMs } from "@langwatch/time";
import { showErrorToast } from "@langwatch/ui-host/errors";
import { formatTimeAgo } from "@langwatch/ui-host/format-time-ago";
import { getMappingSurfaceInputs, parseStudioWorkflow } from "@langwatch/workflow-contract";
import { WorkflowCardDisplay } from "@langwatch/workflow-web/surfaces/workflow-card";
import { api as workflowApi } from "@langwatch/workflow-web/surfaces/workflow-api";
import { ExternalLink } from "lucide-react";

interface WorkflowDrawerProps {
  open?: boolean;
  agentId?: string;
  onClose?: () => void;
}

function workflowFields(rawDsl: unknown) {
  if (!rawDsl) return { inputs: [], outputs: [] };

  const dsl = parseStudioWorkflow(rawDsl);
  const inputs = getMappingSurfaceInputs(dsl.edges, dsl.nodes);
  const end = dsl.nodes.find((node) => node.type === "end" || node.id === "end");
  const outputs: Field[] = end?.data.inputs ?? [];
  return { inputs, outputs };
}

function useWorkflowAgent(agentId: string | undefined, open: boolean) {
  const project = useScenarioHost().project();
  const agent = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId: project?.id ?? "" },
    { enabled: !!agentId && !!project?.id && open },
  );
  const workflowId = agent.data ? linkedWorkflowId(agent.data) : void 0;
  const workflow = workflowApi.workflow.getById.useQuery(
    { projectId: project?.id ?? "", workflowId: workflowId ?? "" },
    { enabled: !!workflowId && !!project?.id && open },
  );

  return {
    project,
    agent,
    workflow,
    ...workflowFields(workflow.data?.currentVersion?.dsl),
    editorHref: project && workflowId ? `/${project.slug}/studio/${workflowId}` : void 0,
    isLoading: !!agentId && (agent.isLoading || workflow.isLoading),
    hasLookupFailed:
      (!!agentId && !agent.isLoading && !agent.data) ||
      (!!workflowId && !workflow.isLoading && !workflow.data),
  };
}

function WorkflowCard(props: {
  workflow: { name: string; icon: string; updatedAt: string };
  href?: string;
  testId: string;
}) {
  const card = (
    <WorkflowCardDisplay
      name={props.workflow.name}
      icon={props.workflow.icon}
      updatedAtLabel={formatTimeAgo(toEpochMs(props.workflow.updatedAt))}
      action={
        props.href ? <ExternalLink size={16} color="var(--chakra-colors-fg-muted)" /> : void 0
      }
      width="300px"
    />
  );

  if (!props.href) return card;

  return (
    <Link href={props.href} target="_blank" rel="noopener noreferrer" data-testid={props.testId}>
      {card}
    </Link>
  );
}

export function AgentWorkflowEditorDrawer(
  props: WorkflowDrawerProps & {
    onSave?: (agent: AgentBrowser) => void;
  },
) {
  const drawer = useDrawer();
  const params = useDrawerParams();
  const agentId = props.agentId ?? params.agentId;
  const open = props.open === true;
  const data = useWorkflowAgent(agentId, open);
  const utils = agentApi.useUtils();
  const close = props.onClose ?? drawer.closeDrawer;
  const update = agentApi.agents.update.useMutation({
    onSuccess(agent) {
      void utils.agents.getAll.invalidate({ projectId: data.project?.id ?? "" });
      void utils.agents.getById.invalidate({ id: agent.id, projectId: data.project?.id ?? "" });
      props.onSave?.(agent);
      close();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't save agent" }),
  });
  const inputs: Field[] = data.inputs.map(({ identifier }) => ({ identifier, type: "str" }));
  const outputs: Field[] = data.outputs.map(({ identifier }) => ({ identifier, type: "str" }));

  return (
    <WorkflowEditor
      key={`${data.project?.id}:${agentId}`}
      open={open}
      agent={data.agent.data}
      isLoading={data.isLoading}
      isSaving={update.isPending}
      workflowInputs={inputs}
      workflowOutputs={outputs}
      defaultMappings={computeBestMatchMappings({
        inputs: inputs.length > 0 ? inputs : [{ identifier: "input" }],
      })}
      workflowCard={
        data.workflow.data && (
          <WorkflowCard
            workflow={data.workflow.data}
            href={data.editorHref}
            testId="open-workflow-editor-link"
          />
        )
      }
      renderMappings={(mapping) => <ScenarioInputMappingSection {...mapping} />}
      onUpdate={(input) => {
        if (data.project) update.mutate({ ...input, projectId: data.project.id });
      }}
      onClose={close}
      onGoBack={drawer.canGoBack ? drawer.goBack : void 0}
    />
  );
}

export function AgentWorkflowTargetEditorDrawer(
  props: WorkflowDrawerProps & {
    availableSources?: AvailableSource[];
    inputMappings?: Record<string, FieldMapping>;
    onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
  },
) {
  const drawer = useDrawer();
  const params = useDrawerParams();
  const agentId = props.agentId ?? params.agentId;
  const open = props.open === true;
  const data = useWorkflowAgent(agentId, open);
  const variables: Field[] =
    data.inputs.length > 0 ? data.inputs : [{ identifier: "input", type: "str" }];

  return (
    <WorkflowTargetEditor
      open={open}
      isLoading={data.isLoading}
      hasLookupFailed={data.hasLookupFailed}
      workflowCard={
        data.workflow.data && (
          <WorkflowCard
            workflow={data.workflow.data}
            href={data.editorHref}
            testId="open-workflow-link"
          />
        )
      }
      mappings={
        <VariablesSection
          title="Input Variables"
          variables={variables}
          onChange={() => void 0}
          showMappings={true}
          availableSources={props.availableSources}
          mappings={props.inputMappings}
          onMappingChange={props.onInputMappingsChange}
          canAddRemove={false}
          readOnly={false}
        />
      }
      onClose={props.onClose ?? drawer.closeDrawer}
      onGoBack={drawer.canGoBack ? drawer.goBack : void 0}
    />
  );
}
