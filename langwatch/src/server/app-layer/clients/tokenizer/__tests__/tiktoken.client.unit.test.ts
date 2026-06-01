import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TiktokenClient } from "../tiktoken.client";
import { NullTokenizerClient } from "../tokenizer.client";

/**
 * These are UNIT tests: they must be deterministic and fully OFFLINE.
 *
 * The real `tiktoken` encoder fetches multi-megabyte BPE rank files over the
 * network (see `TiktokenClient.remoteFetch`). Provisioning those files offline
 * is impractical, so we mock at the encoder boundary instead:
 *   - `tiktoken/lite`               -> a deterministic stub `Tiktoken` whose
 *                                      `encode` returns a token count derived
 *                                      purely from the input text.
 *   - `tiktoken/load`               -> controlled per-test (no network).
 *   - `tiktoken/registry.json` and  -> minimal fixtures so encoding resolution
 *     `tiktoken/model_to_encoding`     works even if the real package (and its
 *                                      WASM build) is absent from node_modules.
 *
 * This keeps the count assertions meaningful (positive, consistent,
 * prefix-invariant) AND guarantees no outbound request is ever made.
 */

// `vi.mock` factories are hoisted ABOVE the imports and run before module
// init, so anything they reference must be hoisted too. `vi.hoisted` is the
// idiomatic way to share values/spies with those factories without tripping
// the "not at the top level" warning.
const { O200K_REGISTRY, deterministicTokenCount, loadMock } = vi.hoisted(() => {
  const O200K_REGISTRY = {
    load_tiktoken_bpe:
      "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken",
    special_tokens: { "<|endoftext|>": 199999 },
    pat_str: "(?:)",
  };

  // Deterministic, input-proportional token count: whitespace-delimited words,
  // at least 1 for any non-empty string. Mirrors the shape of a real tokenizer
  // closely enough that "positive / consistent / prefix-invariant" stay honest.
  const deterministicTokenCount = (text: string): number => {
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, words);
  };

  // `load` is controlled per-test. Default impl is (re)armed in beforeEach.
  const loadMock =
    vi.fn<
      (
        registry: Record<string, unknown>,
        customFetch: (url: string) => Promise<string>,
      ) => Promise<Record<string, unknown>>
    >();

  return { O200K_REGISTRY, deterministicTokenCount, loadMock };
});

vi.mock("tiktoken/lite", () => ({
  Tiktoken: class {
    constructor(
      _bpeRanks: string,
      _specialTokens: Record<string, number>,
      _patStr: string,
    ) {}
    encode(text: string): Uint32Array {
      return new Uint32Array(deterministicTokenCount(text));
    }
    free(): void {}
  },
}));

vi.mock("tiktoken/registry.json", () => ({
  default: { o200k_base: O200K_REGISTRY },
}));

vi.mock("tiktoken/model_to_encoding.json", () => ({
  default: { "gpt-4o": "o200k_base" },
}));

vi.mock("tiktoken/load", () => ({
  load: (
    registry: Record<string, unknown>,
    customFetch: (url: string) => Promise<string>,
  ) => loadMock(registry, customFetch),
}));

// node-fetch-cache's cached fetch delegates to globalThis.fetch in the unit
// env, so the no-hang test's `globalThis.fetch` stub governs the PRIMARY
// (cached) remoteFetch path — the exact path that hangs in production. The
// count tests never reach remoteFetch (their `load` mock returns dummy ranks),
// so this mock is inert there.
vi.mock("node-fetch-cache", () => ({
  default: {
    create() {
      return function cachedFetch(
        url: string,
        init?: { signal?: AbortSignal },
      ) {
        return globalThis.fetch(url, init);
      };
    },
  },
  FileSystemCache: class {
    constructor(_opts?: unknown) {}
  },
}));

describe("TiktokenClient", () => {
  describe("countTokens (offline, encoder stubbed)", () => {
    let client: TiktokenClient;

    beforeEach(() => {
      // Reset call history (loadMock is module-scoped) and re-arm the default
      // impl: no fetch, dummy ranks. Fresh client per test so the internal
      // cache never leaks across cases.
      loadMock.mockClear();
      loadMock.mockImplementation(async (registry: Record<string, unknown>) => ({
        explicit_n_vocab: undefined,
        pat_str: registry.pat_str,
        special_tokens: registry.special_tokens,
        bpe_ranks: "",
      }));
      client = new TiktokenClient();
    });

    it("returns a positive token count for non-empty text", async () => {
      const count = await client.countTokens("gpt-4o", "Hello, world!");
      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe("number");
    });

    it("returns consistent counts for the same input", async () => {
      const count1 = await client.countTokens("gpt-4o", "The quick brown fox");
      const count2 = await client.countTokens("gpt-4o", "The quick brown fox");
      expect(count1).toBe(count2);
    });

    it("caches the encoder across calls (loads BPE data once per encoding)", async () => {
      await client.countTokens("gpt-4o", "first");
      await client.countTokens("gpt-4o", "second");
      expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it("returns undefined for empty text", async () => {
      expect(await client.countTokens("gpt-4o", "")).toBe(undefined);
    });

    it("returns undefined for undefined text", async () => {
      expect(await client.countTokens("gpt-4o", undefined)).toBe(undefined);
    });

    it("strips provider prefix from model name", async () => {
      const withPrefix = await client.countTokens("openai/gpt-4o", "Hello");
      const withoutPrefix = await client.countTokens("gpt-4o", "Hello");
      expect(withPrefix).toBe(withoutPrefix);
    });

    it("falls back to o200k_base for unknown models", async () => {
      const count = await client.countTokens(
        "some-unknown-model-xyz",
        "Hello, world!",
      );
      expect(count).toBeGreaterThan(0);
    });
  });

  describe("when the remote BPE fetch never resolves", () => {
    const ORIGINAL_TIKTOKENS_PATH = process.env.TIKTOKENS_PATH;
    const ORIGINAL_TIMEOUT = process.env.TIKTOKEN_FETCH_TIMEOUT_MS;

    beforeEach(() => {
      // Force the remote path: with no local TIKTOKENS_PATH, fetchBpeRanks goes
      // straight to remoteFetch.
      delete process.env.TIKTOKENS_PATH;
      // Tight ceiling so the test is fast but still exercises the real timer.
      process.env.TIKTOKEN_FETCH_TIMEOUT_MS = "50";

      // Drive the encoder load through the REAL single-URL path so it actually
      // calls customFetch -> fetchBpeRanks -> remoteFetch.
      loadMock.mockImplementation(
        async (
          registry: Record<string, unknown>,
          customFetch: (url: string) => Promise<string>,
        ) => ({
          explicit_n_vocab: undefined,
          pat_str: registry.pat_str,
          special_tokens: registry.special_tokens,
          bpe_ranks: await customFetch(registry.load_tiktoken_bpe as string),
        }),
      );

      // The file-scope `node-fetch-cache` mock routes the cached fetch through
      // globalThis.fetch, so stubbing globalThis.fetch governs the primary
      // remoteFetch path. A fetch that never resolves on its own but rejects
      // when aborted — exactly like a real fetch against a black-holed endpoint.
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal) {
              if (signal.aborted) {
                reject(new Error("aborted"));
                return;
              }
              signal.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            }
          }),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
      if (ORIGINAL_TIKTOKENS_PATH === undefined) {
        delete process.env.TIKTOKENS_PATH;
      } else {
        process.env.TIKTOKENS_PATH = ORIGINAL_TIKTOKENS_PATH;
      }
      if (ORIGINAL_TIMEOUT === undefined) {
        delete process.env.TIKTOKEN_FETCH_TIMEOUT_MS;
      } else {
        process.env.TIKTOKEN_FETCH_TIMEOUT_MS = ORIGINAL_TIMEOUT;
      }
    });

    it("resolves to undefined within the timeout instead of hanging", async () => {
      const client = new TiktokenClient();

      const start = Date.now();
      const result = await client.countTokens("gpt-4o", "hello");
      const elapsed = Date.now() - start;

      // Best-effort tokenization: the bounded fetch times out, loadEncoder's
      // catch turns the throw into `undefined`, and token counting is skipped.
      expect(result).toBe(undefined);
      // Prove the timeout branch was actually exercised: the fetch was invoked
      // (so we reached remoteFetch, not an instant unrelated failure) and
      // elapsed cleared the 50ms timeout floor — yet stayed well under a hang.
      expect(globalThis.fetch).toHaveBeenCalled();
      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(5000);
    });
  });
});

describe("NullTokenizerClient", () => {
  const client = new NullTokenizerClient();

  describe("countTokens", () => {
    it("always returns undefined", async () => {
      expect(await client.countTokens("gpt-4o", "Hello, world!")).toBe(
        undefined,
      );
    });
  });
});
