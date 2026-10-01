const DEFAULT_TOKENIZER_FETCH_TIMEOUT_MS = 10_000;

/** Main's parse of TIKTOKEN_FETCH_TIMEOUT_MS: a positive integer, else ten
 * seconds, never a refusal. */
export function resolveTokenizerFetchTimeoutMs(raw: string | number | undefined): number {
  const parsed = typeof raw === "number" ? raw : Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOKENIZER_FETCH_TIMEOUT_MS;
}
