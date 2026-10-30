import {
  httpAgentConfigSchema,
  isCredentialHeader,
  type AgentInputBinding,
  type Field,
  type HttpAgentConfig,
  type HttpAuth,
  type HttpHeader,
  type HttpMethod,
} from "@langwatch/agent-contract";
import type { HttpTestResult } from "@langwatch/agent-contract/http-test";
import { computeBestMatchMappings, hasScenarioInputMapping } from "@langwatch/scenario-contract";
import { nowInstant, toEpochMs } from "@langwatch/time";
import { isSameOrigin } from "@langwatch/workflow-contract";
import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentBrowser } from "../model/agent-client.ts";
import { newHooksSigningSecret } from "../model/hooks-signing-secret.ts";

export const HTTP_FIXED_VARIABLES: Field[] = [
  { identifier: "threadId", type: "str" },
  { identifier: "input", type: "str" },
  { identifier: "messages", type: "chat_messages" },
];
export const HTTP_FIXED_VARIABLE_IDS = new Set(
  HTTP_FIXED_VARIABLES.map(({ identifier }) => identifier),
);
const EMPTY_MAPPINGS: Record<string, AgentInputBinding> = {};
/** A new agent starts with its fixed variables matched to the scenario's fields, as main's did. */
const BEST_MATCH_MAPPINGS = computeBestMatchMappings({ inputs: HTTP_FIXED_VARIABLES });

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
  hooksUrl: string;
  hooks: { setup: boolean; teardown: boolean };
  /** The stored secret's reference, or a new secret not yet saved. */
  hooksSigningSecret: string;
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
    agentId?: string;
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
    hooksUrl: config?.hooksUrl ?? "",
    hooks: config?.hooks ?? { setup: true, teardown: true },
    hooksSigningSecret: config?.hooksSigningSecret ?? "",
  };
}

function toConfig(draft: HttpAgentDraft): HttpAgentConfig {
  const hooksUrl = draft.hooksUrl.trim();
  return {
    ...draft,
    hooksUrl: hooksUrl || void 0,
    hooks: hooksUrl ? draft.hooks : void 0,
    // No hooks URL, no signing secret: the save then deletes the stored one.
    hooksSigningSecret: (hooksUrl && draft.hooksSigningSecret) || void 0,
    name: "HTTP",
    description: "HTTP API endpoint",
    sessionPath: draft.sessionPath.trim() || void 0,
    headers: draft.headers.length > 0 ? draft.headers : void 0,
    auth: draft.auth?.type === "none" ? void 0 : draft.auth,
    scenarioMappings:
      Object.keys(draft.scenarioMappings).length > 0 ? draft.scenarioMappings : void 0,
  };
}

/** The keys the HTTP editor writes; every other stored key is the editor's to keep. */
const HTTP_EDITOR_KEYS = [
  "name",
  "description",
  "url",
  "method",
  "bodyTemplate",
  "outputPath",
  "sessionPath",
  "headers",
  "auth",
  "scenarioMappings",
  "hooksUrl",
  "hooks",
  "hooksSigningSecret",
] as const;

/** Keys only the server writes: a value a save sends is ignored, so the editor never sends one. */
const HTTP_SERVER_KEYS = ["hooksPreviousSigningSecret"] as const;

/**
 * An edited HTTP config over the stored one: what the editor wrote wins, and what it does not
 * edit (a timeout, a dev tunnel, declared inputs) stays as stored. Server-only keys are dropped.
 */
export function httpConfigKeepingStored({
  stored,
  edited,
}: {
  stored: HttpAgentConfig | undefined;
  edited: HttpAgentConfig;
}): HttpAgentConfig {
  if (!stored) return edited;

  const kept: Partial<HttpAgentConfig> = { ...stored };
  for (const key of [...HTTP_EDITOR_KEYS, ...HTTP_SERVER_KEYS]) delete kept[key];
  return { ...kept, ...edited };
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
    config: httpConfigKeepingStored({
      stored: readHttpConfig(options.agent),
      edited: toConfig(draft),
    }),
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

function unmappedVariableIds(input: {
  showVariables: boolean | undefined;
  hasAtLeastOneMapping: boolean;
  variables: Field[];
}): Set<string> {
  const { showVariables, hasAtLeastOneMapping, variables } = input;

  return showVariables && !hasAtLeastOneMapping
    ? new Set(variables.map(({ identifier }) => identifier))
    : new Set<string>();
}

/** The stored credentials a hooks URL on another origin does not take, to be typed again. */
export interface HooksMoveNotice {
  retypeAuth: boolean;
  retypeHeaders: boolean;
  /** A move keeps no previous signing secret: the stored one stops working on save. */
  replacesSigningSecret: boolean;
}

/**
 * The notice for a hooks URL on another origin than the one the stored credentials were saved
 * for (the saved hooks URL, else the turn URL), or null. The server refuses to send them there,
 * so the form says which ones to type again (agent-secrets.rules.ts, movesStoredSecrets).
 */
function hooksMoveNotice(input: {
  hooksUrl: string;
  saved: HttpAgentConfig | undefined;
}): HooksMoveNotice | null {
  const { hooksUrl, saved } = input;
  if (!saved || hooksUrl.trim() === "") return null;
  const retypeAuth = Boolean(saved.auth && saved.auth.type !== "none");
  const retypeHeaders = (saved.headers ?? []).some(({ key }) => isCredentialHeader(key));
  if (!retypeAuth && !retypeHeaders && !saved.hooksSigningSecret) return null;
  if (isSameOrigin({ requested: hooksUrl.trim(), saved: saved.hooksUrl || saved.url })) {
    return null;
  }

  return { retypeAuth, retypeHeaders, replacesSigningSecret: Boolean(saved.hooksSigningSecret) };
}

/**
 * When the previous signing secret a same-origin rotation left stops working, while it still
 * works; else null. The server keeps it 24 hours (agent-secrets.rules.ts,
 * withPreviousSigningSecret).
 */
function previousSigningSecretValidUntil(saved: HttpAgentConfig | undefined): string | null {
  const expiresAt = saved?.hooksPreviousSigningSecret?.expiresAt;
  if (!expiresAt) return null;

  return toEpochMs(expiresAt) > nowInstant().epochMilliseconds ? expiresAt : null;
}

/**
 * The hooks signing secret the form shows: one made in this session is shown until the drawer
 * closes. Clearing the hooks URL drops an unsaved one. A hooks URL on another origin gets a new
 * one by itself, as the stored one stays with the saved address, which takes it back again.
 */
function useHooksSigningSecret({
  draftSecret,
  saved,
  change,
}: {
  draftSecret: string;
  saved: HttpAgentConfig | undefined;
  change: (values: Partial<HttpAgentDraft>) => void;
}) {
  const savedSecret = saved?.hooksSigningSecret;
  const [newSigningSecret, setNewSigningSecret] = useState<string | null>(null);
  const [madeForMove, setMadeForMove] = useState(false);
  const forget = useCallback(() => {
    setNewSigningSecret(null);
    setMadeForMove(false);
  }, []);

  function makeSigningSecret(input: { hooksUrl?: string; forMove: boolean }) {
    const secret = newHooksSigningSecret();
    setNewSigningSecret(secret);
    setMadeForMove(input.forMove);
    const { hooksUrl } = input;
    change({ ...(hooksUrl === undefined ? {} : { hooksUrl }), hooksSigningSecret: secret });
  }

  function keepStoredSigningSecret(hooksUrl: string) {
    forget();
    change({ hooksUrl, hooksSigningSecret: savedSecret ?? "" });
  }

  function changeHooksUrl(hooksUrl: string) {
    const isCleared = hooksUrl.trim() === "";
    const moves = Boolean(savedSecret) && hooksMoveNotice({ hooksUrl, saved }) !== null;
    const dropsNewSecret = isCleared ? newSigningSecret !== null : !moves && madeForMove;
    if (dropsNewSecret) {
      keepStoredSigningSecret(hooksUrl);
    } else if (!isCleared && (draftSecret === "" || (moves && draftSecret === savedSecret))) {
      makeSigningSecret({ hooksUrl, forMove: moves });
    } else {
      change({ hooksUrl });
    }
  }

  return {
    newSigningSecret,
    hasStoredSigningSecret: Boolean(savedSecret),
    changeHooksUrl,
    rotateSigningSecret: () => makeSigningSecret({ forMove: false }),
    forget,
  };
}

export function useHttpAgentEditor(options: HttpAgentEditorOptions) {
  const savedConfig = readHttpConfig(options.agent);
  const isUnavailable = Boolean(options.agentId) && !savedConfig;
  const defaults = options.defaultScenarioMappings ?? BEST_MATCH_MAPPINGS;
  const inputMappings = options.inputMappings ?? EMPTY_MAPPINGS;
  const [draft, setDraft] = useState(() => initialDraft(void 0, defaults));
  const [dirty, setDirty] = useState(false);
  const [localMappings, setLocalMappings] = useState(inputMappings);
  const [customVariables, setCustomVariables] = useState<Field[]>([]);
  const [activeTab, setActiveTab] = useState(options.showVariables ? "variables" : "body");
  const initialized = useRef<string | undefined>(void 0);
  const identity = options.agentId ?? "new";
  const { forget: forgetSigningSecret, ...signingSecret } = useHooksSigningSecret({
    draftSecret: draft.hooksSigningSecret,
    saved: savedConfig,
    change,
  });

  const [mappingsFrom, setMappingsFrom] = useState(inputMappings);
  if (mappingsFrom !== inputMappings) {
    setMappingsFrom(inputMappings);
    setLocalMappings(inputMappings);
  }
  useEffect(() => {
    if (!options.open) {
      initialized.current = void 0;
      return;
    }
    if (initialized.current === identity || options.isLoadingAgent || isUnavailable) return;

    setDraft(initialDraft(options.agent, defaults));
    forgetSigningSecret();
    setDirty(false);
    initialized.current = identity;
  }, [
    options.open,
    options.agent,
    options.isLoadingAgent,
    defaults,
    identity,
    isUnavailable,
    forgetSigningSecret,
  ]);

  const variables = [...HTTP_FIXED_VARIABLES, ...customVariables];
  const hasAtLeastOneMapping = variables.some(({ identifier }) => localMappings[identifier]);
  const missingMappingIds = unmappedVariableIds({
    showVariables: options.showVariables,
    hasAtLeastOneMapping,
    variables,
  });
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
    changeVariables: (values: Field[]) => {
      setCustomVariables(
        values.filter(({ identifier }) => !HTTP_FIXED_VARIABLE_IDS.has(identifier)),
      );
      setDirty(true);
    },
    changeMapping: (identifier: string, value: AgentInputBinding | undefined) => {
      setLocalMappings((previous) => replaceMapping(previous, identifier, value));
      options.onInputMappingsChange?.(identifier, value);
    },
    changeScenarioMapping: (identifier: string, value: AgentInputBinding | undefined) => {
      setDraft((previous) => ({
        ...previous,
        scenarioMappings: replaceMapping(previous.scenarioMappings, identifier, value),
      }));
      setDirty(true);
    },
    hooks: {
      ...signingSecret,
      moveNotice: hooksMoveNotice({ hooksUrl: draft.hooksUrl, saved: savedConfig }),
      previousSigningSecretValidUntil: previousSigningSecretValidUntil(savedConfig),
    },
    stored: {
      authType: savedConfig?.auth?.type,
      headerKeys: savedConfig?.headers?.map(({ key }) => key) ?? [],
    },
    test: (templateVariables: Record<string, unknown>) => {
      const { url, method, headers, auth, outputPath, bodyTemplate } = draft;
      return options.onTest({
        ...(options.agentId ? { agentId: options.agentId } : {}),
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
