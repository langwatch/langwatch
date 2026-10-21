/**
 * The decision models the Instant Evals column of Default models may hold (ADR-182 decision 2).
 * LangWatch Instant Preview is the hosted, metered default; every other entry runs on the
 * organization's own key, behind the own-decision-model flag. Ids read `<provider>/decisions:<model>`
 * so none collides with a chat model of the same name.
 */

/** Same id as `INSTANT_EVAL_JUDGE_MODEL_ID`; a contract never imports another module's contract. */
export const LANGWATCH_DECISION_MODEL_ID = "langwatch/instant-evals";

/** The one feature the `INSTANT_EVALS` role carries. */
export const INSTANT_EVAL_DECISION_FEATURE_KEY = "instant_eval.judge";

/**
 * The request shapes the Instant Evals judge speaks, one channel each (ADR-182 decision 8).
 * `jev` is the shared body Inception, Perplexity and Cloudflare accept; Cloudflare's REST
 * route wraps the answer in `result`, which `cloudflare_jev` unwraps.
 */
export const DECISION_MODEL_WIRES = ["openai_decisions", "jev", "cloudflare_jev"] as const;
export type DecisionModelWire = (typeof DECISION_MODEL_WIRES)[number];

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
  /** The full URL; `{accountId}` is filled from the provider row. */
  endpoint?: string;
}>;

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
    label: "OpenAI Decisions (gpt-6-luna)",
    description: "OpenAI's Decisions API, on your OpenAI key.",
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
  },
];

/** Each provider row's key field, and its account field where the URL needs one. */
export const DECISION_PROVIDER_KEY_FIELDS: Readonly<
  Record<string, Readonly<{ apiKey: string; accountId?: string }>>
> = {
  openai: { apiKey: "OPENAI_API_KEY" },
  inception: { apiKey: "INCEPTION_API_KEY" },
  perplexity: { apiKey: "PERPLEXITY_API_KEY" },
  cloudflare: { apiKey: "CLOUDFLARE_API_TOKEN", accountId: "CLOUDFLARE_ACCOUNT_ID" },
};

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
      /** The provider URL with its account filled in. */
      endpoint: string;
      /** Decrypted, for the judge's call only; never logged or returned to a browser. */
      apiKey: string;
    }>
  | Readonly<{ kind: "own_unavailable"; model: string; reason: DecisionModelUnavailableReason }>;
