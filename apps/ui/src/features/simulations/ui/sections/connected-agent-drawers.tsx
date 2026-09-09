import {
  ConnectedAgentDrawer as ConnectedAgent,
  ConnectFromCodeDrawer as ConnectFromCode,
} from "@langwatch/agent-web/agent-editors";
import { agentApi } from "@langwatch/agent-web/agent-client";
import { connectedTargetFields } from "@langwatch/experiment-contract";
import {
  VariablesSection,
  type AvailableSource,
  type FieldMapping,
} from "@langwatch/prompt-web/surfaces/variables";
import { CopyButton } from "@langwatch/workflow-web/surfaces/copy-button";
import { SetupWithAgentButton } from "@langwatch/trace-web/surfaces/setup-with-agent-button";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";

export interface ConnectedAgentDrawerProps {
  agentId?: string;
  availableSources?: AvailableSource[];
  inputMappings?: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
}

export function ConnectedAgentDrawer(props: ConnectedAgentDrawerProps) {
  const projectId = useUiCapabilities().session.activeScope().projectId ?? "";
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const agentId = props.agentId ?? params.agentId;
  const query = agentApi.agents.getById.useQuery(
    { id: agentId ?? "", projectId },
    { enabled: Boolean(agentId && projectId), refetchInterval: 5000 },
  );
  const agent = query.data?.type === "connected" ? query.data : void 0;

  return (
    <ConnectedAgent
      key={`${projectId}:${agentId}`}
      agent={agent}
      projectId={projectId}
      isLoading={query.isLoading}
      onClose={closeDrawer}
      inputs={
        agent && props.onInputMappingsChange ? (
          <VariablesSection
            title="Input Variables"
            variables={connectedTargetFields(agent).inputs}
            onChange={() => {}}
            showMappings
            availableSources={props.availableSources}
            mappings={props.inputMappings}
            onMappingChange={props.onInputMappingsChange}
            canAddRemove={false}
            readOnly
          />
        ) : (
          void 0
        )
      }
    />
  );
}

export function ConnectFromCodeDrawer(props: { open?: boolean; onClose?: () => void }) {
  const { closeDrawer, canGoBack, goBack, drawerOpen } = useDrawer();
  return (
    <ConnectFromCode
      open={props.open ?? drawerOpen("connectFromCode")}
      onClose={props.onClose ?? closeDrawer}
      onGoBack={canGoBack ? goBack : void 0}
      setupButton={<SetupWithAgentButton surface="connectedAgents" />}
      renderCopyButton={(input) => <CopyButton {...input} />}
    />
  );
}
