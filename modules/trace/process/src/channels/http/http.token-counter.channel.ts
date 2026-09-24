import { readFile } from "node:fs/promises";
import path from "node:path";

import { createLogger } from "@langwatch/observability";
import type { TraceServerConfig } from "@langwatch/trace-contract";
import { Tiktoken } from "tiktoken/lite";
import { load } from "tiktoken/load";
import modelToEncoding from "tiktoken/model_to_encoding.json" with { type: "json" };
import registry from "tiktoken/registry.json" with { type: "json" };
import { z } from "zod";

import { resolveTokenizerFetchTimeoutMs } from "../../rules/tokenizer-fetch-timeout.rules.ts";
import type { TraceTokenCounter } from "../token-counter.channel.ts";

const logger = createLogger("langwatch:tiktoken");

const DEFAULT_ENCODING = "o200k_base";
const SAFE_FILENAME = /^[a-zA-Z0-9._-]+$/;

const encodingByModel = z.record(z.string(), z.string()).parse(modelToEncoding);
const registryEntries = z.record(z.string(), z.unknown()).parse(registry);

const registryEntrySchema = z.intersection(
  z.union([
    z.object({ load_tiktoken_bpe: z.string() }),
    z.object({
      data_gym_to_mergeable_bpe_ranks: z.object({
        vocab_bpe_file: z.string(),
        encoder_json_file: z.string(),
      }),
    }),
  ]),
  z.object({
    explicit_n_vocab: z.number().optional(),
    pat_str: z.string(),
    special_tokens: z.record(z.string(), z.number()),
  }),
);

/** A port of main's `WorkerTiktokenCounterAdapter`: encoding tables read from
 * TIKTOKENS_PATH, else fetched. */
export class HttpTokenCounterChannel implements TraceTokenCounter {
  static create(tokenizer: TraceServerConfig["tokenizer"]): HttpTokenCounterChannel {
    return new HttpTokenCounterChannel(
      tokenizer.bpeDirectory,
      resolveTokenizerFetchTimeoutMs(tokenizer.fetchTimeoutMs),
    );
  }

  readonly #encoders = new Map<string, Tiktoken>();
  readonly #loading = new Map<string, Promise<Tiktoken | undefined>>();

  private constructor(
    private readonly bpeDirectory: string | undefined,
    private readonly fetchTimeoutMs: number,
  ) {}

  async computeTokenCount(model: string, text: string | undefined): Promise<number | undefined> {
    if (!text) return undefined;
    const modelName = model.split("/").pop() ?? model;
    const encoder = await this.#encoder(encodingByModel[modelName] ?? DEFAULT_ENCODING);
    if (!encoder) return undefined;
    try {
      return encoder.encode(text).length;
    } catch (error) {
      logger.warn({ error, model: modelName }, "tiktoken encode failed");
      return undefined;
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.#loading.values());
    for (const encoder of this.#encoders.values()) encoder.free();
    this.#encoders.clear();
    this.#loading.clear();
  }

  async #encoder(encodingName: string): Promise<Tiktoken | undefined> {
    const cached = this.#encoders.get(encodingName);
    if (cached) return cached;
    const pending = this.#loading.get(encodingName);
    if (pending) return pending;

    const loading = this.#load(encodingName);
    this.#loading.set(encodingName, loading);
    try {
      const encoder = await loading;
      if (encoder) this.#encoders.set(encodingName, encoder);
      return encoder;
    } finally {
      this.#loading.delete(encodingName);
    }
  }

  async #load(encodingName: string): Promise<Tiktoken | undefined> {
    const entry = registryEntrySchema.safeParse(registryEntries[encodingName]);
    if (!entry.success) {
      logger.warn({ encodingName }, "unknown tiktoken encoding, skipping tokenization");
      return undefined;
    }
    try {
      const bpe = await load(entry.data, (url) => this.#readBpeRanks(url));
      return new Tiktoken(bpe.bpe_ranks, bpe.special_tokens, bpe.pat_str);
    } catch (error) {
      logger.warn({ error }, "tiktoken could not be loaded, skipping tokenization");
      return undefined;
    }
  }

  async #readBpeRanks(url: string): Promise<string> {
    const filename = path.basename(url);
    if (this.bpeDirectory && SAFE_FILENAME.test(filename)) {
      const localPath = path.join(this.bpeDirectory, filename);
      try {
        return await readFile(localPath, "utf8");
      } catch (error) {
        logger.warn(
          { localPath, error: error instanceof Error ? error.message : String(error) },
          "Local read failed; falling back to remote fetch",
        );
      }
    }
    const response = await fetch(url, { signal: AbortSignal.timeout(this.fetchTimeoutMs) });
    if (!response.ok) throw new Error(`tiktoken remote fetch answered ${response.status}`);
    return response.text();
  }
}
