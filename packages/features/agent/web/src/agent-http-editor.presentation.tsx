import type { AgentInputBinding, Field } from "@langwatch/agent-contract";
import type { ReactNode } from "react";

export type AgentHttpEditorPresentation = {
  renderScenarioMappings: (input: {
    inputs: Field[];
    mappings: Record<string, AgentInputBinding>;
    onMappingChange: (identifier: string, mapping: AgentInputBinding | undefined) => void;
  }) => ReactNode;
  renderVariables: (input: {
    variables: Field[];
    mappings: Record<string, AgentInputBinding>;
    onChange: (variables: Field[]) => void;
    onMappingChange: (identifier: string, mapping: AgentInputBinding | undefined) => void;
    missingMappingIds: Set<string>;
    lockedVariableIds: Set<string>;
  }) => ReactNode;
  explainTestError: (input: { errorCode?: string; error?: string }) => {
    title: string;
    description?: string;
  };
  showSaveError: (input: { error: unknown; fallbackTitle: string }) => void;
};
