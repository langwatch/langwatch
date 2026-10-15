import { getComplexProps, getFlowCallbacks } from "@langwatch/browser-host/drawer";
import type { AvailableSource, FieldMapping } from "@langwatch/workflow-contract";
import { useState } from "react";

/** The agent drawers an evaluation workbench opens on a target, handing it its sources. */
export type TargetEditorDrawer =
  | "agentWorkflowTargetEditor"
  | "agentCodeEditor"
  | "agentHttpEditor";

/** What the workbench hands a target's drawer: sources, mappings and a writer. */
export type TargetInputMapping = {
  availableSources: AvailableSource[];
  inputMappings: Record<string, FieldMapping>;
  onInputMappingsChange?: (identifier: string, mapping: FieldMapping | undefined) => void;
};

// Stable, so an editor that resets on a new mappings object does not reset on every render.
const NO_SOURCES: AvailableSource[] = [];
const NO_MAPPINGS: Record<string, FieldMapping> = {};

/**
 * Reads the opener's props for a target's drawer. A mapping change persists at once through the
 * opener's writer, and shows at once from the drawer's own copy.
 */
export function useTargetInputMapping(drawer: TargetEditorDrawer): TargetInputMapping {
  const complexProps = getComplexProps();
  const opened =
    (complexProps.inputMappings as Record<string, FieldMapping> | undefined) ?? NO_MAPPINGS;
  const [shown, setShown] = useState({ opened, mappings: opened });
  if (shown.opened !== opened) setShown({ opened, mappings: opened });

  const write = getFlowCallbacks(drawer)?.onInputMappingsChange as
    | TargetInputMapping["onInputMappingsChange"]
    | undefined;
  const onInputMappingsChange = write
    ? (identifier: string, mapping: FieldMapping | undefined) => {
        setShown((current) => {
          const mappings = { ...current.mappings };
          if (mapping) mappings[identifier] = mapping;
          else delete mappings[identifier];
          return { ...current, mappings };
        });
        write(identifier, mapping);
      }
    : void 0;

  return {
    availableSources:
      (complexProps.availableSources as AvailableSource[] | undefined) ?? NO_SOURCES,
    inputMappings: shown.opened === opened ? shown.mappings : opened,
    ...(onInputMappingsChange ? { onInputMappingsChange } : {}),
  };
}
