import type { AgentInputBinding, Field } from "@langwatch/agent-contract";
import type { ReactNode } from "react";

export type RenderScenarioMappingsInput = {
  inputs: Field[];
  mappings: Record<string, AgentInputBinding>;
  onMappingChange: (identifier: string, mapping: AgentInputBinding | undefined) => void;
};

export type RenderAgentVariablesInput = {
  variables: Field[];
  mappings: Record<string, AgentInputBinding>;
  onChange: (variables: Field[]) => void;
  onMappingChange: (identifier: string, mapping: AgentInputBinding | undefined) => void;
  missingMappingIds: Set<string>;
  lockedVariableIds: Set<string>;
};

export abstract class AgentHttpEditorPresentationPort {
  abstract renderScenarioMappings(input: RenderScenarioMappingsInput): ReactNode;

  abstract renderVariables(input: RenderAgentVariablesInput): ReactNode;

  /**
   * The test panel shown below the form for a saved agent: send one turn and
   * read the reply. The host renders it, because the panel runs against the
   * host's scenario execution transport, which this package does not hold.
   */
  abstract renderTestPanel(input: { agentId: string; projectId: string }): ReactNode;

  abstract explainTestError(input: { errorCode?: string; error?: string }): {
    title: string;
    description?: string;
  };

  abstract showSaveError(input: { error: unknown; fallbackTitle: string }): void;
}
