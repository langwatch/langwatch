/**
 * Reading a provider's models answer. Every field past the id is optional and vendor-specific,
 * so each is taken only when plainly stated, and an entry is never guessed into a kind it did
 * not declare. Spec: specs/model-providers/custom-provider-model-import.feature
 */

/** One model a provider listed. */
export type ListedModel = {
  id: string;
  /** Context window, when the entry states one. */
  maxTokens?: number;
  /** The entry advertises reasoning controls. */
  hasReasoning?: boolean;
  /** The entry explicitly marks itself as an embeddings model. */
  isEmbedding?: boolean;
};

/** Largest listing body read, in characters. A bigger one is treated as no listing. */
export const MODEL_LISTING_MAX_CHARACTERS = 2 * 1024 * 1024;

/** Most models taken from one listing. Entries past this are ignored. */
export const MODEL_LISTING_MAX_MODELS = 2000;

/** Longest model id accepted. */
const MAX_MODEL_ID_LENGTH = 256;

/** Fields vendors use for the context window, in the order they are trusted. */
const MAX_TOKENS_FIELDS = [
  "context_length",
  "max_model_len",
  "context_window",
  "max_context_length",
  "max_tokens",
] as const;

/** Fields whose value names the kind of model. */
const KIND_FIELDS = ["type", "mode", "object", "task"] as const;

const EMBEDDING_KINDS = new Set(["embedding", "embeddings"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** OpenAI and Anthropic answer `data[]`, Gemini `models[]`; null when the body is neither. */
function entriesOf(body: unknown): unknown[] | null {
  if (!isRecord(body)) return null;
  if (Array.isArray(body.data)) return body.data;
  return Array.isArray(body.models) ? body.models : null;
}

/**
 * The models in a listing body, in order, deduplicated and capped. Null means the body is not a
 * listing at all; an empty array means a listing with no usable entries.
 */
export function listedModelsFromListing(body: unknown): ListedModel[] | null {
  const entries = entriesOf(body);
  if (!entries) return null;

  const seen = new Set<string>();
  const models: ListedModel[] = [];
  for (const entry of entries) {
    if (models.length >= MODEL_LISTING_MAX_MODELS) break;
    const model = toListedModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

/** Same as {@link listedModelsFromListing}, from the raw body text. */
export function listedModelsFromListingText(text: string): ListedModel[] | null {
  if (text.length > MODEL_LISTING_MAX_CHARACTERS) return null;
  try {
    return listedModelsFromListing(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

function toListedModel(entry: unknown): ListedModel | undefined {
  if (!isRecord(entry)) return undefined;
  const id = (asString(entry.id) || asString(entry.name)).replace(/^models\//, "");
  if (id === "" || id.length > MAX_MODEL_ID_LENGTH) return undefined;

  const model: ListedModel = { id };
  const maxTokens = readMaxTokens(entry);
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (readsReasoning(entry)) model.hasReasoning = true;
  if (marksEmbedding(entry)) model.isEmbedding = true;
  return model;
}

function readMaxTokens(entry: Record<string, unknown>): number | undefined {
  for (const field of MAX_TOKENS_FIELDS) {
    const value = entry[field];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function readsReasoning(entry: Record<string, unknown>): boolean {
  const efforts = entry.supported_reasoning_efforts;
  if (Array.isArray(efforts) && efforts.length > 0) return true;
  const parameters = entry.supported_parameters;
  return Array.isArray(parameters) && parameters.includes("reasoning");
}

function marksEmbedding(entry: Record<string, unknown>): boolean {
  for (const field of KIND_FIELDS) {
    const value = entry[field];
    if (typeof value === "string" && EMBEDDING_KINDS.has(value.toLowerCase())) return true;
  }
  const capabilities = entry.capabilities;
  if (Array.isArray(capabilities)) {
    return capabilities.some(
      (capability) =>
        typeof capability === "string" && EMBEDDING_KINDS.has(capability.toLowerCase()),
    );
  }
  if (isRecord(capabilities)) {
    return capabilities.embeddings === true || capabilities.embedding === true;
  }
  return false;
}
