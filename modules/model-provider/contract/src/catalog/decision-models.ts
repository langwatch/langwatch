/**
 * The decision models the Instant Evals column may hold (ADR-182 decision 2): the hosted, metered
 * LangWatch Instant Preview, then own-key models behind the own-decision-model flag. Ids read
 * `<provider>/decisions:<model>` so none collides with a chat model of the same name.
 */

/** Same id as `INSTANT_EVAL_JUDGE_MODEL_ID`; a contract never imports another module's contract. */
export const LANGWATCH_DECISION_MODEL_ID = "langwatch/instant-evals";

/** The one feature the `INSTANT_EVALS` role carries. */
export const INSTANT_EVAL_DECISION_FEATURE_KEY = "instant_eval.judge";

/**
 * The request shapes the Instant Evals judge speaks, one channel each (ADR-182 decision 8).
 * `jev` is the System One body (Jev, Inception, Perplexity, Microsoft-Decision-1, OpenRouter);
 * Cloudflare's REST route wraps that answer in `result`, which `cloudflare_jev` unwraps.
 */
export const DECISION_MODEL_WIRES = ["openai_decisions", "jev", "cloudflare_jev"] as const;
export type DecisionModelWire = (typeof DECISION_MODEL_WIRES)[number];

/** How the key travels: `Authorization: Bearer`, or Azure's `api-key` header. */
export const DECISION_MODEL_AUTH_HEADERS = ["bearer", "api_key"] as const;
export type DecisionModelAuthHeader = (typeof DECISION_MODEL_AUTH_HEADERS)[number];

/**
 * One `{name}` in an endpoint, filled from a provider row field. `value` sends the field URL-encoded;
 * `azure_resource` reads the resource name from an Azure endpoint URL and `aws_region` takes only an
 * AWS region name, so neither can point a key at another host (ADR-182 decision 5).
 */
export type DecisionEndpointParam = Readonly<{
  field: string;
  read: "value" | "azure_resource" | "aws_region";
}>;

export type DecisionModelEntry = Readonly<{
  id: string;
  /** The registry provider whose row holds the key; `langwatch` is the hosted classifier. */
  provider: string;
  label: string;
  description: string;
  /** Absent for the hosted classifier, which the judge reaches through its own client. */
  wire?: DecisionModelWire;
  /** The model name sent in the request body. */
  providerModel?: string;
  /** A row field that, when set, replaces `providerModel`: an Azure deployment name. */
  providerModelField?: string;
  /** The URL template; each `{name}` is one of `endpointParams`. */
  endpoint?: string;
  endpointParams?: Readonly<Record<string, DecisionEndpointParam>>;
  /** Bearer when absent. */
  authHeader?: DecisionModelAuthHeader;
  /** The row field holding this entry's key, when it is not the provider's `apiKey`. */
  keyField?: string;
}>;

const CLOUDFLARE_ACCOUNT = {
  accountId: { field: "CLOUDFLARE_ACCOUNT_ID", read: "value" },
} as const;
const AZURE_RESOURCE = {
  resource: { field: "AZURE_OPENAI_ENDPOINT", read: "azure_resource" },
} as const;
/** OpenRouter's Decisions route takes the System One body; it is still under `/api/alpha`. */
const OPENROUTER_DECISIONS = "https://openrouter.ai/api/alpha/decisions";

export const DECISION_MODELS: readonly DecisionModelEntry[] = [
  {
    id: LANGWATCH_DECISION_MODEL_ID,
    provider: "langwatch",
    label: "LangWatch Instant Preview",
    description: "Hosted by LangWatch and billed with your plan.",
  },
  {
    id: "openai/decisions:gpt-6-luna",
    provider: "openai",
    label: "OpenAI Decisions API",
    description: "gpt-6-luna, on your OpenAI key.",
    wire: "openai_decisions",
    providerModel: "gpt-6-luna",
    endpoint: "https://api.openai.com/v1/decisions",
  },
  {
    id: "inception/decisions:mercury-decide",
    provider: "inception",
    label: "Inception Mercury Decide",
    description: "Inception's decision model, on your Inception key.",
    wire: "jev",
    providerModel: "mercury-decide",
    endpoint: "https://api.inceptionlabs.ai/v1/decisions",
  },
  {
    id: "perplexity/decisions:pplx-decider-v1.2",
    provider: "perplexity",
    label: "Perplexity Decider v1.2",
    description: "Perplexity's 27B decision model, on your Perplexity key.",
    wire: "jev",
    providerModel: "pplx-decider-v1.2",
    endpoint: "https://api.perplexity.ai/v1/decisions",
  },
  {
    id: "perplexity/decisions:pplx-decider-flash-v1.2",
    provider: "perplexity",
    label: "Perplexity Decider Flash v1.2",
    description: "Perplexity's faster 4B decision model, on your Perplexity key.",
    wire: "jev",
    providerModel: "pplx-decider-flash-v1.2",
    endpoint: "https://api.perplexity.ai/v1/decisions",
  },
  {
    id: "cloudflare/decisions:clef",
    provider: "cloudflare",
    label: "Cloudflare Clef",
    description: "Cloudflare Workers AI, on your Cloudflare account.",
    wire: "cloudflare_jev",
    providerModel: "clef",
    endpoint:
      "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/clef",
    endpointParams: CLOUDFLARE_ACCOUNT,
  },
  {
    id: "cloudflare/decisions:clef-flash",
    provider: "cloudflare",
    label: "Cloudflare Clef Flash",
    description: "The faster Clef, on your Cloudflare account.",
    wire: "cloudflare_jev",
    providerModel: "clef-flash",
    endpoint:
      "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/clef-flash",
    endpointParams: CLOUDFLARE_ACCOUNT,
  },
  {
    id: "typesafe/decisions:jev-1.14.0",
    provider: "typesafe",
    label: "TypeSafe Jev 1.14",
    description: "TypeSafe's Jev, on your TypeSafe key.",
    wire: "jev",
    providerModel: "jev-1.14.0",
    endpoint: "https://api.typesafe.ai/v1/systemone",
  },
  {
    id: "azure/decisions:gpt-6-luna",
    provider: "azure",
    label: "Azure OpenAI Decisions API",
    description: "gpt-6-luna, on your own Azure OpenAI resource.",
    wire: "openai_decisions",
    providerModel: "gpt-6-luna",
    providerModelField: "AZURE_OPENAI_DECISIONS_DEPLOYMENT",
    endpoint: "https://{resource}.openai.azure.com/openai/v1/decisions",
    endpointParams: AZURE_RESOURCE,
    authHeader: "api_key",
  },
  {
    id: "azure/decisions:microsoft-decision-1",
    provider: "azure",
    label: "Microsoft Decision 1 (Azure)",
    description: "Microsoft's decision model on your own Azure AI Foundry resource.",
    wire: "jev",
    providerModel: "Microsoft-Decision-1",
    providerModelField: "AZURE_DECISION_1_DEPLOYMENT",
    endpoint: "https://{resource}.services.ai.azure.com/providers/microsoft/v1/systemone",
    endpointParams: AZURE_RESOURCE,
    authHeader: "api_key",
  },
  {
    id: "bedrock/decisions:gpt-6-luna",
    provider: "bedrock",
    label: "OpenAI Decisions API (Bedrock)",
    description: "gpt-6-luna on Amazon Bedrock, on your Bedrock API key.",
    wire: "openai_decisions",
    providerModel: "openai.gpt-6-luna",
    endpoint: "https://bedrock-mantle.{region}.api.aws/openai/v1/decisions",
    endpointParams: { region: { field: "AWS_REGION_NAME", read: "aws_region" } },
    // The access key pair signs requests and is never a bearer token.
    keyField: "AWS_BEARER_TOKEN_BEDROCK",
  },
  {
    id: "openrouter/decisions:typesafe/jev-1.14",
    provider: "openrouter",
    label: "Jev 1.14 (OpenRouter)",
    description: "TypeSafe's Jev through OpenRouter, on your OpenRouter key.",
    wire: "jev",
    providerModel: "typesafe/jev-1.14",
    endpoint: OPENROUTER_DECISIONS,
  },
  {
    id: "openrouter/decisions:microsoft/microsoft-decision-1",
    provider: "openrouter",
    label: "Microsoft Decision 1 (OpenRouter)",
    description: "Microsoft's decision model through OpenRouter, on your OpenRouter key.",
    wire: "jev",
    providerModel: "microsoft/microsoft-decision-1",
    endpoint: OPENROUTER_DECISIONS,
  },
  {
    id: "openrouter/decisions:liquid/d1.1",
    provider: "openrouter",
    label: "Liquid d1.1 (OpenRouter)",
    description: "Liquid AI's decision model through OpenRouter, on your OpenRouter key.",
    wire: "jev",
    providerModel: "liquid/d1.1",
    endpoint: OPENROUTER_DECISIONS,
  },
  {
    id: "fireworks/decisions:rune",
    provider: "fireworks",
    label: "Fireworks Rune",
    description: "Fireworks' decision model, on your Fireworks key.",
    wire: "openai_decisions",
    providerModel: "accounts/fireworks/models/rune",
    endpoint: "https://api.fireworks.ai/inference/v1/decisions",
  },
];

/**
 * An `https` Azure AI endpoint: the resource name, one of Azure's own AI domains, then only a
 * path. A port, credentials or any other host never match.
 */
const AZURE_AI_ENDPOINT =
  /^https:\/\/([a-z0-9][a-z0-9-]{0,62})\.(?:openai\.azure\.com|cognitiveservices\.azure\.com|services\.ai\.azure\.com)(?:[/?#].*)?$/i;

/** An endpoint read as Azure: its resource name, or `not_azure` for any other URL. */
export type AzureEndpointRead =
  | Readonly<{ kind: "azure"; resource: string }>
  | Readonly<{ kind: "not_azure" }>;

export function azureResourceOf(endpoint: string): AzureEndpointRead {
  const resource = AZURE_AI_ENDPOINT.exec(endpoint.trim())?.[1];
  return resource ? { kind: "azure", resource: resource.toLowerCase() } : { kind: "not_azure" };
}

/** An AWS region name such as `us-east-1` or `us-gov-west-1`; nothing else becomes a host label. */
const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d{1,2}$/;

/** The region as a lowercase name, or undefined for anything that is not one. */
export function awsRegionOf(region: string): string | undefined {
  const name = region.trim().toLowerCase();
  return AWS_REGION.test(name) ? name : undefined;
}

export function findDecisionModel(id: string): DecisionModelEntry | undefined {
  return DECISION_MODELS.find((entry) => entry.id === id);
}

export function isDecisionModelId(id: string): boolean {
  return findDecisionModel(id) !== undefined;
}

/** Whether a stored column value runs on the organization's own key. */
export function isOwnDecisionModelId(id: string): boolean {
  return isDecisionModelId(id) && id !== LANGWATCH_DECISION_MODEL_ID;
}

/** Why a project's own decision model cannot run; none of them falls back to LangWatch. */
export const DECISION_MODEL_UNAVAILABLE_REASONS = [
  // The flag is off for the organization; it never falls back to the billed classifier.
  "not_enabled",
  "provider_missing",
  "provider_disabled",
  "key_missing",
  // A row field the endpoint is built from names a host the catalogue does not allow.
  "endpoint_invalid",
] as const;
export type DecisionModelUnavailableReason = (typeof DECISION_MODEL_UNAVAILABLE_REASONS)[number];

/** What a project's Instant Evals run on (ADR-182 decision 5). */
export type DecisionModelResolution =
  | Readonly<{ kind: "langwatch" }>
  | Readonly<{
      kind: "own";
      model: string;
      wire: DecisionModelWire;
      providerModel: string;
      /** The provider URL with its account or resource filled in. */
      endpoint: string;
      authHeader: DecisionModelAuthHeader;
      /** Decrypted, for the judge's call only; never logged or returned to a browser. */
      apiKey: string;
    }>
  | Readonly<{ kind: "own_unavailable"; model: string; reason: DecisionModelUnavailableReason }>;
