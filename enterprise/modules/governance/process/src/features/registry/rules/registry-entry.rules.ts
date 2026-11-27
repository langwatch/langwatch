// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { Agent, Field } from "@langwatch/agent-contract";
import type {
  AgentRegistryEndpoint,
  AgentRegistryEntry,
  AgentRegistryModel,
  AgentRegistrySource,
  AgentRegistryTool,
} from "@langwatch/enterprise-governance-contract";
import { Temporal, toEpochMs, type Instant, type TimeInput } from "@langwatch/time";

/** A tool as a source defines it; the registry adds its lifecycle (status, deprecation). */
type RegistryDraftTool = Pick<
  AgentRegistryTool,
  "name" | "description" | "input_schema" | "output_schema"
>;

/** One agent as its source describes it now, before the registry versions it. */
export type RegistryDraft = Omit<
  AgentRegistryEntry,
  | "id"
  | "status"
  | "posture"
  | "version"
  | "tools"
  | "first_seen_at"
  | "last_seen_at"
  | "updated_at"
  | "removed_at"
> & {
  sourceKey: string;
  /** Ids a traced agent's `gen_ai.agent.id` may carry for this agent; never stored. */
  matchIds?: readonly string[];
  /** When the source says it created the agent; the dormancy window counts from the earlier. */
  sourceCreatedAt?: Instant | null;
  /** The traffic read could not judge dormancy; the held entry's answer stands. */
  dormancyUnsettled?: boolean;
  tools: RegistryDraftTool[];
  firstSeenAt: Instant;
  lastSeenAt: Instant | null;
};

type JsonSchema = Record<string, unknown>;
type AgentField = Field;

const FIELD_JSON_TYPES: Readonly<Record<string, JsonSchema>> = {
  str: { type: "string" },
  int: { type: "integer" },
  float: { type: "number" },
  bool: { type: "boolean" },
  dict: { type: "object" },
  list: { type: "array" },
  "list[str]": { type: "array", items: { type: "string" } },
  "list[int]": { type: "array", items: { type: "integer" } },
  "list[float]": { type: "array", items: { type: "number" } },
  "list[bool]": { type: "array", items: { type: "boolean" } },
  image: { type: "string", format: "uri" },
  file: { type: "string", format: "uri" },
  chat_messages: {
    type: "array",
    items: {
      type: "object",
      properties: { role: { type: "string" }, content: { type: "string" } },
      required: ["role", "content"],
    },
  },
};

function fieldSchemaOf(field: AgentField): JsonSchema {
  const base =
    field.type === "json_schema" && field.json_schema
      ? { ...field.json_schema }
      : { ...FIELD_JSON_TYPES[field.type] };
  return field.desc ? { ...base, description: field.desc } : base;
}

/** An agent's input or output fields as one JSON Schema object; hidden fields stay out. */
function fieldsToJsonSchema(fields: readonly AgentField[] | undefined): JsonSchema {
  const visible = (fields ?? []).filter((field) => !field.hidden);
  return {
    type: "object",
    properties: Object.fromEntries(
      visible.map((field) => [field.identifier, fieldSchemaOf(field)]),
    ),
    required: visible.filter((field) => !field.optional).map((field) => field.identifier),
  };
}

type ConnectedConfig = Extract<Agent, { type: "connected" }>["config"];

/** A connected function's declared parameters; a secret parameter never carries its default. */
function connectedParametersToJsonSchema(parameters: ConnectedConfig["parameters"]): JsonSchema {
  const properties = Object.fromEntries(
    parameters.map((parameter) => {
      const schema: JsonSchema = { type: parameter.type ?? "string" };
      if (parameter.description) schema.description = parameter.description;
      if (parameter.options?.length) schema.enum = parameter.options;
      if (parameter.secret) schema.writeOnly = true;
      else if (parameter.defaultValue !== undefined) schema.default = parameter.defaultValue;
      return [parameter.name, schema];
    }),
  );
  return {
    type: "object",
    properties,
    required: parameters.filter((parameter) => parameter.required).map(({ name }) => name),
  };
}

type SignatureConfig = Extract<Agent, { type: "signature" }>["config"];

type SignatureFields = Pick<RegistryDraft, "model" | "instructions" | "source_version">;

/** The model parameters a signature agent sets, primitives only. */
function modelParameters(
  llm: NonNullable<SignatureConfig["llm"]>,
): AgentRegistryModel["parameters"] {
  const parameters: AgentRegistryModel["parameters"] = {};
  for (const [name, value] of Object.entries(llm)) {
    if (name === "model" || name === "litellm_params") continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      parameters[name] = value;
    }
  }
  return parameters;
}

/**
 * What a prompt-based agent says about its model, system prompt and prompt version.
 * `openai/gpt-5-mini` names its provider; a bare model name does not.
 */
function signatureFields(config: SignatureConfig): SignatureFields {
  const llm = config.llm;
  const slash = llm?.model ? llm.model.indexOf("/") : -1;
  const system = config.messages?.find((message) => message.role === "system")?.content;
  return {
    model: llm?.model
      ? {
          provider: slash > 0 ? llm.model.slice(0, slash) : null,
          model: slash > 0 ? llm.model.slice(slash + 1) : llm.model,
          parameters: modelParameters(llm),
        }
      : null,
    instructions: system || config.prompt || null,
    source_version: config.versionMetadata ? String(config.versionMetadata.versionNumber) : null,
  };
}

const NO_SIGNATURE_FIELDS: SignatureFields = {
  model: null,
  instructions: null,
  source_version: null,
};

function toolsOf(agent: Agent): RegistryDraftTool[] {
  if (agent.type === "connected") {
    return [
      {
        name: "call",
        description: "Send one conversation turn to the connected agent.",
        input_schema: connectedParametersToJsonSchema(agent.config.parameters),
        output_schema: null,
      },
    ];
  }
  const inputs = "inputs" in agent.config ? agent.config.inputs : undefined;
  const outputs = "outputs" in agent.config ? agent.config.outputs : undefined;
  return [
    {
      name: "invoke",
      description: "Run the agent with its declared inputs.",
      input_schema: fieldsToJsonSchema(inputs),
      output_schema: outputs?.length ? fieldsToJsonSchema(outputs) : null,
    },
  ];
}

function endpointsOf({
  agent,
  publicBaseUrl,
  consoleUrl,
}: {
  agent: Agent;
  publicBaseUrl: string;
  consoleUrl: string | null;
}): AgentRegistryEndpoint[] {
  const base = publicBaseUrl.replace(/\/+$/, "");
  const endpoints: AgentRegistryEndpoint[] = [
    { kind: "definition", url: `${base}/api/v1/agents/${agent.id}`, protocol: "langwatch-rest" },
  ];
  if (agent.type === "connected") {
    endpoints.push({
      kind: "invoke",
      url: `${base}/api/v1/agents/${agent.id}/call`,
      protocol: "langwatch-rest",
    });
  }
  if (agent.type === "http") {
    endpoints.push(...httpInvokeEndpoints(agent.config.url));
  }
  if (consoleUrl) endpoints.push({ kind: "console", url: consoleUrl, protocol: "https" });
  return endpoints;
}

const HTTP_SCHEMES = new Set(["http:", "https:"]);

/**
 * An HTTP agent's URL as the registry may publish it: the origin only. Path, user info, query and
 * fragment can each hold the only credential (webhook tokens, `?code=` function keys). A URL that
 * does not parse or is not http(s) publishes no endpoint.
 */
function httpInvokeEndpoints(raw: string): AgentRegistryEndpoint[] {
  if (!URL.canParse(raw)) return [];
  const url = new URL(raw);
  if (!HTTP_SCHEMES.has(url.protocol)) return [];
  return [{ kind: "invoke", url: url.origin, protocol: "http" }];
}

function describedBy(agent: Agent): Pick<RegistryDraft, "description"> {
  const description = "description" in agent.config ? agent.config.description : undefined;
  const trimmed = typeof description === "string" ? description.trim() : "";
  return { description: trimmed === "" ? null : trimmed };
}

function instant(at: TimeInput): Instant {
  return Temporal.Instant.fromEpochMilliseconds(toEpochMs(at));
}

/**
 * A LangWatch-defined agent as a registry draft. Credentials an HTTP agent holds (auth, headers)
 * never reach the entry. Spec: specs/agent-registry.feature
 */
export function langwatchAgentDraft({
  agent,
  ownerName,
  publicBaseUrl,
  consoleUrl,
}: {
  agent: Agent;
  ownerName: string | null;
  publicBaseUrl: string;
  consoleUrl: string | null;
}): RegistryDraft {
  const tools = toolsOf(agent);
  const signature =
    agent.type === "signature" ? signatureFields(agent.config) : NO_SIGNATURE_FIELDS;
  return {
    sourceKey: `langwatch:${agent.id}`,
    matchIds: [agent.id],
    source: "langwatch",
    management: "managed",
    shadow: false,
    dormant: false,
    platform: null,
    labels: {},
    owner_label: null,
    kind: agent.type,
    name: agent.name,
    ...describedBy(agent),
    ...signature,
    project_id: agent.projectId,
    environment: agent.environment ?? null,
    owner: agent.ownerUserId ? { user_id: agent.ownerUserId, name: ownerName } : null,
    endpoints: endpointsOf({ agent, publicBaseUrl, consoleUrl }),
    capabilities: [agent.type, ...tools.map((tool) => tool.name)],
    tools,
    firstSeenAt: instant(agent.createdAt),
    lastSeenAt: agent.lastSeenAt ? instant(agent.lastSeenAt) : null,
  };
}

/** The registry sources a governance source's sightings enter as. */
export type DiscoveredRegistrySource = Extract<
  AgentRegistrySource,
  "databricks" | "copilot_studio" | "aws" | "gcp" | "ard"
>;

type DiscoveredRegistryRecord = {
  id: string;
  source: DiscoveredRegistrySource;
  rawAgentId: string;
  displayText: string;
  metadata: Readonly<Record<string, unknown>>;
  firstSeenAt: Instant;
  lastSeenAt: Instant;
};

const DISCOVERED_KIND: Readonly<Record<"databricks" | "copilot_studio", string>> = {
  databricks: "genie_space",
  copilot_studio: "copilot_bot",
};

function metadataText(metadata: DiscoveredRegistryRecord["metadata"], field: string) {
  const value = metadata[field];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A metadata field holding JSON, parsed; anything that does not parse reads as absent. */
function metadataJson(metadata: DiscoveredRegistryRecord["metadata"], field: string): unknown {
  const text = metadataText(metadata, field);
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function labelsOf(metadata: DiscoveredRegistryRecord["metadata"]): Record<string, string> {
  const parsed = metadataJson(metadata, "tags");
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter((pair): pair is [string, string] => typeof pair[1] === "string"),
  );
}

function matchIdsOf(agent: DiscoveredRegistryRecord): string[] {
  const parsed = metadataJson(agent.metadata, "matchIds");
  const listed = Array.isArray(parsed)
    ? parsed.filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  return [...new Set([agent.rawAgentId, ...listed])];
}

/** The source's creation date as an instant; absent or unreadable reads as no date. */
function sourceCreatedAtOf(text: string | null): Pick<RegistryDraft, "sourceCreatedAt"> {
  if (text === null) return {};
  try {
    return { sourceCreatedAt: Temporal.Instant.from(text) };
  } catch {
    return {};
  }
}

/**
 * A provider-listed agent as a registry draft: what the provider named, nothing guessed. The
 * cloud owner tag is a label, never a LangWatch owner. Spec: specs/cloud-agent-discovery.feature
 */
export function discoveredAgentDraft(agent: DiscoveredRegistryRecord): RegistryDraft {
  const { metadata } = agent;
  const platform = metadataText(metadata, "platform");
  const kind =
    agent.source === "databricks" || agent.source === "copilot_studio"
      ? DISCOVERED_KIND[agent.source]
      : (platform ?? agent.source);
  const place =
    metadataText(metadata, "consoleUrl") ??
    metadataText(metadata, "environmentUrl") ??
    metadataText(metadata, "workspaceUrl");
  const model = metadataText(metadata, "model");
  return {
    sourceKey: `discovered:${agent.id}`,
    matchIds: matchIdsOf(agent),
    ...sourceCreatedAtOf(metadataText(metadata, "createdAt")),
    source: agent.source,
    management: "discovered",
    shadow: false,
    dormant: false,
    platform,
    labels: labelsOf(metadata),
    owner_label: metadataText(metadata, "owner"),
    kind,
    name: agent.displayText,
    description: metadataText(metadata, "description"),
    source_version: metadataText(metadata, "modifiedOn") ?? metadataText(metadata, "updatedAt"),
    project_id: null,
    environment: null,
    owner: null,
    endpoints: place ? [{ kind: "console", url: place, protocol: "https" }] : [],
    model: model ? { provider: null, model, parameters: {} } : null,
    instructions: null,
    capabilities: [kind],
    tools: [],
    firstSeenAt: agent.firstSeenAt,
    lastSeenAt: agent.lastSeenAt,
  };
}
