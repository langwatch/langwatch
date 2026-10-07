/**
 * Reading an OpenAI-compatible `/v1/models` listing.
 *
 * The credential probe already GETs this endpoint to prove a key works. When
 * the provider answers, the body names the models it serves, and the
 * custom-provider import reads it from here. Every field past `id` is
 * optional and vendor-specific, so each one is taken only when it is plainly
 * stated, and an entry is never guessed into a kind it did not declare.
 *
 * Framework-free on purpose: no fetch, no database, no registry.
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

/** Largest listing body read. A bigger one is treated as no listing. */
export const MODEL_LISTING_MAX_BYTES = 2 * 1024 * 1024;

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

type ByteReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(reason?: unknown): Promise<void>;
};

/**
 * Reads a response body as text, giving up past `maxBytes`.
 *
 * Returns `undefined` for a missing body or one over the cap, and cancels the
 * stream in the second case so the rest is never downloaded.
 */
export async function readBoundedText({
  body,
  maxBytes = MODEL_LISTING_MAX_BYTES,
}: {
  body: { getReader(): ByteReader } | null | undefined;
  maxBytes?: number;
}): Promise<string | undefined> {
  if (!body) return undefined;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(concatChunks({ chunks, total }));
}

function concatChunks({
  chunks,
  total,
}: {
  chunks: Uint8Array[];
  total: number;
}): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Parses a listing body. `undefined` means the body is not an OpenAI-shaped
 * listing at all; an empty array means it is one with no usable entries.
 */
export function parseModelListingText(
  text: string | undefined,
): ListedModel[] | undefined {
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return parseModelListing(parsed);
}

/** Same as {@link parseModelListingText}, from an already parsed value. */
export function parseModelListing(body: unknown): ListedModel[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined;

  const seen = new Set<string>();
  const models: ListedModel[] = [];
  for (const entry of body.data) {
    if (models.length >= MODEL_LISTING_MAX_MODELS) break;
    const model = toListedModel(entry);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models;
}

function toListedModel(entry: unknown): ListedModel | undefined {
  if (!isRecord(entry) || typeof entry.id !== "string") return undefined;
  const id = entry.id.trim();
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
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
      return value;
    }
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
    if (typeof value === "string" && EMBEDDING_KINDS.has(value.toLowerCase())) {
      return true;
    }
  }
  const capabilities = entry.capabilities;
  if (Array.isArray(capabilities)) {
    return capabilities.some(
      (c) => typeof c === "string" && EMBEDDING_KINDS.has(c.toLowerCase()),
    );
  }
  if (isRecord(capabilities)) {
    return capabilities.embeddings === true || capabilities.embedding === true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
