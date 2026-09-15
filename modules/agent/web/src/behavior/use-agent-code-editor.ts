import { useEffect, useState } from "react";
import type { AgentInputBinding, CodeAgentConfig, Field } from "@langwatch/agent-contract";
import { computeBestMatchMappings, isScenarioMappingValid } from "@langwatch/scenario-contract";
import type { AgentBrowser } from "../model/agent-client.ts";
import { buildCodeConfig, DEFAULT_CODE, getCodeFromConfig } from "../model/agent-code-config.ts";

const DEFAULT_INPUTS: Field[] = [{ identifier: "input", type: "str" }];
const DEFAULT_OUTPUTS: Field[] = [{ identifier: "output", type: "str" }];
type SaveInput = { projectId: string; name: string; config: CodeAgentConfig };

export interface AgentCodeEditorOptions {
  open?: boolean;
  agentId?: string;
  agent?: AgentBrowser | null;
  projectId?: string;
  errorMessage?: string;
  onClose(): void;
  onSave?: (agent: AgentBrowser) => void;
  onCreate(input: SaveInput): Promise<AgentBrowser>;
  onUpdate(input: SaveInput & { id: string }): Promise<AgentBrowser>;
  onError(error: unknown): void;
}

type CodeDraft = {
  name: string;
  code: string;
  inputs: Field[];
  outputs: Field[];
  scenarioMappings: Record<string, AgentInputBinding>;
  scenarioOutputField: string | undefined;
};

function createDraft(agent?: AgentBrowser | null): CodeDraft {
  if (agent?.type !== "code") {
    return {
      name: "",
      code: DEFAULT_CODE,
      inputs: DEFAULT_INPUTS,
      outputs: DEFAULT_OUTPUTS,
      scenarioMappings: computeBestMatchMappings({ inputs: DEFAULT_INPUTS }),
      scenarioOutputField: void 0,
    };
  }

  const inputs = agent.config.inputs ?? DEFAULT_INPUTS;
  const existingMappings = agent.config.scenarioMappings ?? {};
  const scenarioMappings =
    Object.keys(existingMappings).length > 0
      ? existingMappings
      : computeBestMatchMappings({ inputs: inputs.length > 0 ? inputs : DEFAULT_INPUTS });

  return {
    name: agent.name,
    code: getCodeFromConfig(agent.config),
    inputs,
    outputs: agent.config.outputs ?? DEFAULT_OUTPUTS,
    scenarioMappings,
    scenarioOutputField: agent.config.scenarioOutputField,
  };
}

function mappingsForInputs(inputs: Field[], existing: Record<string, AgentInputBinding>) {
  const effectiveInputs = inputs.length > 0 ? inputs : DEFAULT_INPUTS;
  const defaults = computeBestMatchMappings({ inputs: effectiveInputs });
  const mappings: Record<string, AgentInputBinding> = {};

  for (const input of effectiveInputs) {
    const mapping = existing[input.identifier] ?? defaults[input.identifier];
    if (mapping) mappings[input.identifier] = mapping;
  }
  return mappings;
}

function useCodeDraft(props: AgentCodeEditorOptions) {
  const [draft, setDraft] = useState(() => createDraft(props.agent));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (props.agent?.type === "code" || !props.agentId) {
      setDraft(createDraft(props.agent));
      setDirty(false);
    }
  }, [props.agent, props.agentId, props.open]);

  const change = (update: Partial<CodeDraft>) => {
    setDraft((current) => ({ ...current, ...update }));
    setDirty(true);
  };

  const changeInputs = (inputs: Field[]) => {
    change({ inputs, scenarioMappings: mappingsForInputs(inputs, draft.scenarioMappings) });
  };

  const changeOutputs = (outputs: Field[]) => {
    const keepsSelection = outputs.some(
      (output) => output.identifier === draft.scenarioOutputField,
    );
    change({ outputs, scenarioOutputField: keepsSelection ? draft.scenarioOutputField : void 0 });
  };

  const changeMapping = (identifier: string, mapping: AgentInputBinding | undefined) => {
    const scenarioMappings = { ...draft.scenarioMappings };
    if (mapping) scenarioMappings[identifier] = mapping;
    else delete scenarioMappings[identifier];
    change({ scenarioMappings });
  };

  return { draft, dirty, change, changeInputs, changeOutputs, changeMapping };
}

export function useAgentCodeEditor(props: AgentCodeEditorOptions) {
  const form = useCodeDraft(props);
  const { draft } = form;
  const valid =
    draft.name.trim().length > 0 && isScenarioMappingValid({ mappings: draft.scenarioMappings });

  const save = async () => {
    if (!props.projectId || !valid || props.errorMessage) return;
    const input = {
      projectId: props.projectId,
      name: draft.name.trim(),
      config: buildCodeConfig(draft),
    };

    try {
      const agent = props.agentId
        ? await props.onUpdate({ ...input, id: props.agentId })
        : await props.onCreate(input);
      props.onSave?.(agent);
      props.onClose();
    } catch (error) {
      props.onError(error);
    }
  };

  const close = () => {
    if (form.dirty && !window.confirm("You have unsaved changes. Are you sure you want to close?"))
      return;
    props.onClose();
  };

  return {
    ...form,
    valid,
    save,
    close,
    scenarioInputs: draft.inputs.length > 0 ? draft.inputs : DEFAULT_INPUTS,
  };
}
