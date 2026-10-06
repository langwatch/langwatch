import { getComplexProps, getFlowCallbacks } from "@langwatch/browser-host/drawer";
import type { AvailableSource, FieldMapping } from "@langwatch/workflow-contract";

/** What the workbench hands the workflow target's drawer: sources, mappings and a writer. */
export type WorkflowTargetMapping = {
  availableSources: AvailableSource[];
  inputMappings: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
};

/** Reads the opener's props for agentWorkflowTargetEditor; a mapping change persists at once. */
export function useWorkflowTargetMapping(): WorkflowTargetMapping {
  const complexProps = getComplexProps();
  const onInputMappingsChange = getFlowCallbacks("agentWorkflowTargetEditor")
    ?.onInputMappingsChange as WorkflowTargetMapping["onInputMappingsChange"];
  return {
    availableSources: (complexProps.availableSources as AvailableSource[] | undefined) ?? [],
    inputMappings: (complexProps.inputMappings as Record<string, FieldMapping> | undefined) ?? {},
    ...(onInputMappingsChange ? { onInputMappingsChange } : {}),
  };
}
