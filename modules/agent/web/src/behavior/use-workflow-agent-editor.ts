import {
  workflowAgentConfigSchema,
  type AgentInputBinding,
  type Field,
  type WorkflowAgentConfig,
} from "@langwatch/agent-contract";
import { isScenarioMappingValid } from "@langwatch/scenario-contract";
import { useEffect, useReducer, useRef } from "react";

export interface WorkflowAgentEditorOptions {
  open: boolean;
  agent?: { id: string; name: string; config: unknown };
  isLoading: boolean;
  isSaving: boolean;
  workflowInputs: Field[];
  workflowOutputs: Field[];
  defaultMappings: Record<string, AgentInputBinding>;
  onUpdate(input: { id: string; name: string; config: WorkflowAgentConfig }): void;
  onClose(): void;
}

interface WorkflowDraft {
  name: string;
  mappings: Record<string, AgentInputBinding>;
  outputField?: string;
  dirty: boolean;
}

type DraftChange =
  | {
      type: "initialize";
      agent: { name: string; config: unknown };
      defaults: Record<string, AgentInputBinding>;
    }
  | { type: "name"; value: string }
  | { type: "output"; value: string | undefined }
  | { type: "mapping"; identifier: string; value: AgentInputBinding | undefined };

function updateDraft(draft: WorkflowDraft, change: DraftChange): WorkflowDraft {
  switch (change.type) {
    case "initialize": {
      const config = workflowAgentConfigSchema.parse(change.agent.config);
      const mappings = config.scenarioMappings ?? {};
      return {
        name: change.agent.name,
        mappings: Object.keys(mappings).length > 0 ? mappings : change.defaults,
        outputField: config.scenarioOutputField,
        dirty: false,
      };
    }
    case "name":
      return { ...draft, name: change.value, dirty: true };
    case "output":
      return { ...draft, outputField: change.value, dirty: true };
    case "mapping": {
      const mappings = { ...draft.mappings };
      if (change.value) mappings[change.identifier] = change.value;
      else delete mappings[change.identifier];
      return { ...draft, mappings, dirty: true };
    }
  }
}

export function useWorkflowAgentEditor(options: WorkflowAgentEditorOptions) {
  const [draft, dispatch] = useReducer(updateDraft, { name: "", mappings: {}, dirty: false });
  const { name, mappings, outputField } = draft;
  const initializedAgent = useRef("");

  useEffect(() => {
    if (!options.open) {
      initializedAgent.current = "";
      return;
    }
    if (!options.agent || options.isLoading || initializedAgent.current === options.agent.id)
      return;

    dispatch({ type: "initialize", agent: options.agent, defaults: options.defaultMappings });
    initializedAgent.current = options.agent.id;
  }, [options.agent, options.defaultMappings, options.isLoading, options.open]);

  const isValid =
    !options.isLoading &&
    name.trim().length > 0 &&
    options.workflowInputs.length > 0 &&
    options.workflowOutputs.length > 0 &&
    isScenarioMappingValid({ mappings });

  function save() {
    if (!options.agent || !isValid || options.isSaving) return;

    const config = workflowAgentConfigSchema.parse(options.agent.config);
    options.onUpdate({
      id: options.agent.id,
      name: name.trim(),
      config: {
        ...config,
        name: name.trim(),
        scenarioMappings: mappings,
        scenarioOutputField: outputField,
      },
    });
  }

  function close() {
    if (draft.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close?"))
      return;
    options.onClose();
  }

  return {
    name,
    mappings,
    outputField,
    isValid,
    save,
    close,
    changeMapping(identifier: string, value: AgentInputBinding | undefined) {
      dispatch({ type: "mapping", identifier, value });
    },
    changeName(value: string) {
      dispatch({ type: "name", value });
    },
    changeOutputField(value: string | undefined) {
      dispatch({ type: "output", value });
    },
  };
}
