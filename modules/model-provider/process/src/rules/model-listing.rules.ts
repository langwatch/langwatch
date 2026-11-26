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

/** What reading a body found: a listing (maybe with no usable entries), or no listing at all. */
export type ModelListingRead =
  | { kind: "listing"; models: ListedModel[] }
  | { kind: "not-a-listing" };

const NOT_A_LISTING: ModelListingRead = { kind: "not-a-listing" };

type ListingEntries = { kind: "entries"; entries: unknown[] } | { kind: "not-a-listing" };

/** OpenAI and Anthropic answer `data[]`, Gemini `models[]`. */
function readListingEntries(body: unknown): ListingEntries {
  if (isRecord(body) && Array.isArray(body.data)) return { kind: "entries", entries: body.data };
  if (isRecord(body) && Array.isArray(body.models)) {
    return { kind: "entries", entries: body.models };
  }
  return { kind: "not-a-listing" };
}

/** The models in a listing body, in order, deduplicated and capped. */
export function readModelListing(body: unknown): ModelListingRead {
  const read = readListingEntries(body);
  if (read.kind === "not-a-listing") return NOT_A_LISTING;
  const { entries } = read;

  const seen = new Set<string>();
  const models: ListedModel[] = [];
  for (const entry of entries) {
    if (models.length >= MODEL_LISTING_MAX_MODELS) break;
    const [model] = toListedModels(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return { kind: "listing", models };
}

/** Same as {@link readModelListing}, from the raw body text. */
export function readModelListingText(text: string): ModelListingRead {
  if (text.length > MODEL_LISTING_MAX_CHARACTERS) return NOT_A_LISTING;
  try {
    return readModelListing(JSON.parse(text) as unknown);
  } catch {
    return NOT_A_LISTING;
  }
}

/** One entry as a model, or none when it has no usable id. */
function toListedModels(entry: unknown): ListedModel[] {
  if (!isRecord(entry)) return [];
  const id = (asString(entry.id) || asString(entry.name)).replace(/^models\//, "");
  if (id === "" || id.length > MAX_MODEL_ID_LENGTH) return [];

  return [
    {
      id,
      ...maxTokensOf(entry),
      ...(readsReasoning(entry) && { hasReasoning: true }),
      ...(marksEmbedding(entry) && { isEmbedding: true }),
    },
  ];
}

/** The context window as a partial model: empty when the entry states none. */
function maxTokensOf(entry: Record<string, unknown>): Pick<ListedModel, "maxTokens"> {
  for (const field of MAX_TOKENS_FIELDS) {
    const value = entry[field];
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return { maxTokens: value };
    }
  }
  return {};
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
