import {
  httpAgentConfigSchema,
  type AgentInputBinding,
  type Field,
  type HttpAgentConfig,
  type HttpAuth,
  type HttpHeader,
  type HttpMethod,
} from "@langwatch/agent-contract";
import { hasScenarioInputMapping } from "@langwatch/scenario-contract";
import { useEffect, useRef, useState } from "react";
import type { AgentBrowser } from "../model/agent-client.ts";
import type { HttpTestResult } from "../model/http-test.types.ts";

export const HTTP_FIXED_VARIABLES: Field[] = [
  { identifier: "threadId", type: "str" },
  { identifier: "input", type: "str" },
  { identifier: "messages", type: "chat_messages" },
];
export const HTTP_FIXED_VARIABLE_IDS = new Set(
  HTTP_FIXED_VARIABLES.map(({ identifier }) => identifier),
);
const EMPTY_MAPPINGS: Record<string, AgentInputBinding> = {};

interface HttpAgentDraft {
  name: string;
  url: string;
  method: HttpMethod;
  bodyTemplate: string;
  outputPath: string;
  sessionPath: string;
  headers: HttpHeader[];
  auth: HttpAuth | undefined;
  scenarioMappings: Record<string, AgentInputBinding>;
}

type SaveHttpAgentInput = { projectId: string; name: string; config: HttpAgentConfig };

export interface HttpAgentEditorOptions {
  open?: boolean;
  agentId?: string;
  agent?: AgentBrowser | null;
  isLoadingAgent?: boolean;
  isSaving?: boolean;
  projectId?: string;
  onClose(): void;
  onSave?: (agent: AgentBrowser) => void;
  onCreate(input: SaveHttpAgentInput): Promise<AgentBrowser>;
  onUpdate(input: SaveHttpAgentInput & { id: string }): Promise<AgentBrowser>;
  onTest(input: {
    url: string;
    method: HttpMethod;
    headers: HttpHeader[];
    auth: HttpAuth | undefined;
    outputPath: string;
    bodyTemplate: string;
    templateVariables: Record<string, unknown>;
  }): Promise<HttpTestResult>;
  onSaveError(input: { error: unknown; fallbackTitle: string }): void;
  defaultScenarioMappings?: Record<string, AgentInputBinding>;
  showVariables?: boolean;
  inputMappings?: Record<string, AgentInputBinding>;
  onInputMappingsChange?: (identifier: string, mapping: AgentInputBinding | undefined) => void;
}

function readHttpConfig(agent: AgentBrowser | null | undefined) {
  if (agent?.type !== "http") return;

  const parsed = httpAgentConfigSchema.safeParse(agent.config);
  return parsed.success ? parsed.data : void 0;
}

function initialDraft(
  agent: AgentBrowser | null | undefined,
  mappings: Record<string, AgentInputBinding>,
): HttpAgentDraft {
  const config = readHttpConfig(agent);
  const savedMappings = config?.scenarioMappings ?? {};

  return {
    name: config ? (agent?.name ?? "") : "",
    url: config?.url || "https://api.example.com/agent/chat",
    method: config?.method ?? "POST",
    bodyTemplate:
      config?.bodyTemplate || '{\n  "thread_id": "{{threadId}}",\n  "messages": {{messages}}\n}',
    outputPath: config?.outputPath || "$.choices[0].message.content",
    sessionPath: config?.sessionPath ?? "",
    headers: config?.headers ?? [],
    auth: config?.auth ?? { type: "none" },
    scenarioMappings: Object.keys(savedMappings).length > 0 ? savedMappings : mappings,
  };
}

function toConfig(draft: HttpAgentDraft): HttpAgentConfig {
  return {
    ...draft,
    name: "HTTP",
    description: "HTTP API endpoint",
    sessionPath: draft.sessionPath.trim() || void 0,
    headers: draft.headers.length > 0 ? draft.headers : void 0,
    auth: draft.auth?.type === "none" ? void 0 : draft.auth,
    scenarioMappings:
      Object.keys(draft.scenarioMappings).length > 0 ? draft.scenarioMappings : void 0,
  };
}

function replaceMapping(
  mappings: Record<string, AgentInputBinding>,
  identifier: string,
  value: AgentInputBinding | undefined,
) {
  const next = { ...mappings };
  if (value) next[identifier] = value;
  else delete next[identifier];
  return next;
}

async function saveHttpAgent(
  options: HttpAgentEditorOptions,
  draft: HttpAgentDraft,
  isValid: boolean,
) {
  if (!options.projectId || !isValid || options.isSaving) return;

  const input = {
    projectId: options.projectId,
    name: draft.name.trim(),
    config: toConfig(draft),
  };
  const result = options.agentId
    ? options.onUpdate({ ...input, id: options.agentId })
    : options.onCreate(input);
  await result
    .then((agent) => {
      options.onSave?.(agent);
      options.onClose();
    })
    .catch((error: unknown) => {
      options.onSaveError({
        error,
        fallbackTitle: options.agentId ? "Couldn't save agent" : "Couldn't create agent",
      });
    });
}

export function useHttpAgentEditor(options: HttpAgentEditorOptions) {
  const isUnavailable = Boolean(options.agentId) && !readHttpConfig(options.agent);
  const defaults = options.defaultScenarioMappings ?? EMPTY_MAPPINGS;
  const inputMappings = options.inputMappings ?? EMPTY_MAPPINGS;
  const [draft, setDraft] = useState(() => initialDraft(void 0, defaults));
  const [dirty, setDirty] = useState(false);
  const [localMappings, setLocalMappings] = useState(inputMappings);
  const [customVariables, setCustomVariables] = useState<Field[]>([]);
  const [activeTab, setActiveTab] = useState(options.showVariables ? "variables" : "body");
  const initialized = useRef<string | undefined>(void 0);
  const identity = options.agentId ?? "new";

  useEffect(() => {
    setLocalMappings(inputMappings);
  }, [inputMappings]);
  useEffect(() => {
    if (!options.open) {
      initialized.current = void 0;
      return;
    }
    if (initialized.current === identity || options.isLoadingAgent || isUnavailable) return;

    setDraft(initialDraft(options.agent, defaults));
    setDirty(false);
    initialized.current = identity;
  }, [options.open, options.agent, options.isLoadingAgent, defaults, identity, isUnavailable]);

  const variables = [...HTTP_FIXED_VARIABLES, ...customVariables];
  const hasAtLeastOneMapping = variables.some(({ identifier }) => localMappings[identifier]);
  const missingMappingIds =
    options.showVariables && !hasAtLeastOneMapping
      ? new Set(variables.map(({ identifier }) => identifier))
      : new Set<string>();
  const isValid =
    !isUnavailable &&
    draft.name.trim().length > 0 &&
    draft.url.trim().length > 0 &&
    hasScenarioInputMapping(draft.scenarioMappings);

  function change(values: Partial<HttpAgentDraft>) {
    setDraft((previous) => ({ ...previous, ...values }));
    setDirty(true);
  }

  function close() {
    if (dirty && !window.confirm("You have unsaved changes. Are you sure you want to close?"))
      return;
    options.onClose();
  }

  return {
    draft,
    change,
    save: () => saveHttpAgent(options, draft, isValid),
    close,
    activeTab,
    setActiveTab,
    variables,
    localMappings,
    hasAtLeastOneMapping,
    missingMappingIds,
    isValid,
    isUnavailable,
    changeVariables(values: Field[]) {
      setCustomVariables(
        values.filter(({ identifier }) => !HTTP_FIXED_VARIABLE_IDS.has(identifier)),
      );
      setDirty(true);
    },
    changeMapping(identifier: string, value: AgentInputBinding | undefined) {
      setLocalMappings((previous) => replaceMapping(previous, identifier, value));
      options.onInputMappingsChange?.(identifier, value);
    },
    changeScenarioMapping(identifier: string, value: AgentInputBinding | undefined) {
      setDraft((previous) => ({
        ...previous,
        scenarioMappings: replaceMapping(previous.scenarioMappings, identifier, value),
      }));
      setDirty(true);
    },
    test(templateVariables: Record<string, unknown>) {
      const { url, method, headers, auth, outputPath, bodyTemplate } = draft;
      return options.onTest({
        url,
        method,
        headers,
        auth,
        outputPath,
        bodyTemplate,
        templateVariables,
      });
    },
  };
}
