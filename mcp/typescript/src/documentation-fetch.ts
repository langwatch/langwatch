export type DocumentationKind = "langwatch" | "scenario";

const TRUSTED_DOCUMENTATION_ORIGIN = "https://langwatch.ai";
const MAX_DOCUMENTATION_BYTES = 2 * 1024 * 1024;
const DOCUMENTATION_TIMEOUT_MS = 30_000;
const DOCUMENTATION_CONTENT_TYPES = new Set(["text/markdown", "text/plain"]);

const DOCUMENTATION_CONFIG: Record<DocumentationKind, { defaultPath: string; namespace: string }> =
  {
    langwatch: {
      defaultPath: "/docs/llms.txt",
      namespace: "/docs",
    },
    scenario: {
      defaultPath: "/scenario/llms.txt",
      namespace: "/scenario",
    },
  };

function documentationUrlError(namespace: string): Error {
  return new Error(
    `Only a trusted LangWatch documentation URL under ${TRUSTED_DOCUMENTATION_ORIGIN}${namespace}/ may be fetched`,
  );
}

export function resolveDocumentationUrl(kind: DocumentationKind, input?: string): URL {
  const { defaultPath, namespace } = DOCUMENTATION_CONFIG[kind];
  const value = input?.trim();
  let url: URL;

  try {
    if (!value) {
      url = new URL(defaultPath, TRUSTED_DOCUMENTATION_ORIGIN);
    } else if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value) || value.startsWith("//")) {
      url = new URL(value, TRUSTED_DOCUMENTATION_ORIGIN);
    } else {
      const relativePath = value.replace(/^\/+/, "");
      const namespacePath = namespace.slice(1);
      const path =
        relativePath === namespacePath || relativePath.startsWith(`${namespacePath}/`)
          ? `/${relativePath}`
          : `${namespace}/${relativePath}`;
      url = new URL(path, TRUSTED_DOCUMENTATION_ORIGIN);
    }
  } catch {
    throw documentationUrlError(namespace);
  }

  const isTrustedDocumentationUrl =
    url.protocol === "https:" &&
    url.hostname === "langwatch.ai" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(`${namespace}/`);
  if (!isTrustedDocumentationUrl) {
    throw documentationUrlError(namespace);
  }

  const lowerPath = url.pathname.toLowerCase();
  if (!lowerPath.endsWith(".md") && !lowerPath.endsWith(".txt")) {
    url.pathname += ".md";
  }

  return url;
}

/** `signal` is the caller's: a client that goes away stops the fetch, as the timeout does. */
export async function fetchDocumentation(
  kind: DocumentationKind,
  input?: string,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  const url = resolveDocumentationUrl(kind, input);
  const timeout = AbortSignal.timeout(DOCUMENTATION_TIMEOUT_MS);
  const response = await fetchImplementation(url, {
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    throw new Error(`Documentation request failed with status ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";
  if (!DOCUMENTATION_CONTENT_TYPES.has(contentType)) {
    throw new Error("Documentation response has an unexpected content type");
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_DOCUMENTATION_BYTES) {
    throw new Error("Documentation response is too large");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    receivedBytes += value.byteLength;
    if (receivedBytes > MAX_DOCUMENTATION_BYTES) {
      await reader.cancel();
      throw new Error("Documentation response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** How many fetches a shared fetcher runs at once, and what it keeps for repeat callers. */
export type DocumentationFetchLimits = Readonly<{
  maxInFlight: number;
  cacheTtlMs: number;
  maxCacheEntries: number;
  maxCacheBytes: number;
}>;

/** The anonymous docs endpoint's limits: one process serves every caller with these. */
export const DOCS_ENDPOINT_FETCH_LIMITS: DocumentationFetchLimits = {
  maxInFlight: 16,
  cacheTtlMs: 60_000,
  maxCacheEntries: 256,
  maxCacheBytes: 32 * 1024 * 1024,
};

type CachedDocument = { text: string; bytes: number; expiresAt: number };

/**
 * Fetches shared by every caller in one process: a bounded number in flight, past which a call
 * is refused rather than queued, and a short cache keyed by the resolved URL, since the docs are
 * public and the same for everyone. Only the anonymous docs server uses one.
 */
export class SharedDocumentationFetcher {
  readonly #limits: DocumentationFetchLimits;
  readonly #fetchImplementation: typeof fetch;
  readonly #now: () => number;
  /** Insertion order is eviction order. */
  readonly #cache = new Map<string, CachedDocument>();
  #cachedBytes = 0;
  #inFlight = 0;

  constructor({
    limits,
    fetchImplementation = (input, init) => fetch(input, init),
    now = () => Date.now(),
  }: {
    limits: DocumentationFetchLimits;
    fetchImplementation?: typeof fetch;
    now?: () => number;
  }) {
    this.#limits = limits;
    this.#fetchImplementation = fetchImplementation;
    this.#now = now;
  }

  async fetch({
    kind,
    url,
    signal,
  }: {
    kind: DocumentationKind;
    url?: string | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<string> {
    // Resolved first, so a refused URL neither counts against the bound nor reaches the cache.
    const key = resolveDocumentationUrl(kind, url).href;
    const cached = this.#cached(key);
    if (cached !== undefined) return cached;

    if (this.#inFlight >= this.#limits.maxInFlight) {
      throw new Error(
        "The LangWatch docs are busy serving other requests. Retry in a few seconds.",
      );
    }
    this.#inFlight++;
    try {
      const text = await fetchDocumentation(kind, url, this.#fetchImplementation, signal);
      this.#store(key, text);
      return text;
    } finally {
      this.#inFlight--;
    }
  }

  #cached(key: string): string | undefined {
    const entry = this.#cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > this.#now()) return entry.text;
    this.#evict(key, entry);
    return undefined;
  }

  #store(key: string, text: string): void {
    const bytes = Buffer.byteLength(text);
    if (bytes > this.#limits.maxCacheBytes) return;
    const previous = this.#cache.get(key);
    if (previous) this.#evict(key, previous);
    this.#cache.set(key, { text, bytes, expiresAt: this.#now() + this.#limits.cacheTtlMs });
    this.#cachedBytes += bytes;
    for (const [oldestKey, oldest] of this.#cache) {
      const withinLimits =
        this.#cache.size <= this.#limits.maxCacheEntries &&
        this.#cachedBytes <= this.#limits.maxCacheBytes;
      if (withinLimits) return;
      this.#evict(oldestKey, oldest);
    }
  }

  #evict(key: string, entry: CachedDocument): void {
    this.#cache.delete(key);
    this.#cachedBytes -= entry.bytes;
  }
}
