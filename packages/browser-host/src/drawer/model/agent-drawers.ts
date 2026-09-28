import type {
  AgentCascadeArchive,
  AgentInputBinding,
  AgentWithFields,
  Field,
  RelatedAgentEntities,
  WorkflowAgentConfig,
} from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import type { ReactNode } from "react";

/** The kinds of agent a caller can start from agent's type selector. */
export type UiNewAgentType = "code" | "workflow" | "http";

/** What a caller hands agent's type selector drawer. */
export type UiAgentTypeSelectorDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onGoBack?: () => void;
  canGoBack?: boolean;
  onSelect?: (type: UiNewAgentType) => void;
  /** Where "Connect from Code" goes; opened by address, it navigates to the connect drawer. */
  onConnectFromCode?: () => void;
};

/** The archive flow agent's list drawer runs for the agent it is asked to delete. */
export type UiAgentListArchiveOptions = {
  onGetRelated: (agentId: string) => Promise<RelatedAgentEntities>;
  onDelete(agentId: string): Promise<void>;
  onCascadeArchive(agentId: string): Promise<WireOf<AgentCascadeArchive>>;
  onArchived(workflowArchived: boolean): void;
  onError: (error: unknown) => void;
};

/** What a caller hands agent's list drawer: the agents, as the browser receives them. */
export type UiAgentListDrawerProps = UiAgentListArchiveOptions & {
  open: boolean;
  items: WireOf<AgentWithFields>[];
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
  onSelect(agent: WireOf<AgentWithFields>): void;
  onEdit(agent: WireOf<AgentWithFields>): void;
  onCreateNew: () => void;
};

/** The workflow agent agent's workflow editor edits, and what it saves. */
export type UiWorkflowAgentEditorOptions = {
  open: boolean;
  agent?: { id: string; name: string; config: unknown };
  isLoading: boolean;
  isSaving: boolean;
  workflowInputs: Field[];
  workflowOutputs: Field[];
  defaultMappings: Record<string, AgentInputBinding>;
  onUpdate: (input: { id: string; name: string; config: WorkflowAgentConfig }) => void;
  onClose: () => void;
};

/** What agent's workflow editor hands the caller's mapping section. */
export type UiAgentWorkflowMappingProps = {
  inputs: Field[];
  outputs: Field[];
  mappings: Record<string, AgentInputBinding>;
  outputField?: string;
  onMappingChange(identifier: string, mapping: AgentInputBinding | undefined): void;
  onOutputFieldChange(field: string | undefined): void;
};

/** What a caller hands agent's workflow editor drawer. */
export type UiAgentWorkflowEditorDrawerProps = UiWorkflowAgentEditorOptions & {
  workflowCard?: ReactNode;
  renderMappings(props: UiAgentWorkflowMappingProps): ReactNode;
  onGoBack?: () => void;
};

/** What a caller hands agent's HTTP or code editor: the agent to edit, and where a save goes. */
export type UiAgentEditorDrawerProps = {
  agentId?: string;
  onSave?: (agent: WireOf<AgentWithFields>) => void;
};

/** What a caller hands agent's workflow selector drawer: where the agent it creates goes. */
export type UiWorkflowSelectorDrawerProps = {
  onSave?: (agent: WireOf<AgentWithFields>) => void;
};
