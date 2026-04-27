import fs from "fs/promises";
import path from "path";
import { createLogger } from "~/utils/logger/server";
import type { TokenizerClient } from "./tokenizer.client";

const logger = createLogger("langwatch:tiktoken");

type Tiktoken = { encode: (text: string) => Uint32Array; free: () => void };

export class TiktokenClient implements TokenizerClient {
  private readonly cache = new Map<string, Tiktoken>();
  private readonly loading = new Map<string, Promise<Tiktoken | undefined>>();

  async countTokens(
    model: string,
    text: string | undefined,
  ): Promise<number | undefined> {
    if (!text) return undefined;

    // Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o")
    const modelName = model.includes("/") ? model.split("/").pop()! : model;

    const encoder = await this.getEncoder(modelName);
    if (!encoder) return undefined;

    try {
      return encoder.encode(text).length;
    } catch (error) {
      logger.warn({ error, model: modelName }, "tiktoken encode failed");
      return undefined;
    }
  }

  async prewarm(models: string[]): Promise<void> {
    await Promise.all(models.map((m) => this.getEncoder(m)));
  }

  private async getEncoder(model: string): Promise<Tiktoken | undefined> {
    if (this.cache.has(model)) return this.cache.get(model)!;

    // Deduplicate concurrent loads for the same encoding
    const encodingName = await this.resolveEncoding(model);
    if (this.loading.has(encodingName)) return this.loading.get(encodingName)!;

    const promise = this.loadEncoder(encodingName);
    this.loading.set(encodingName, promise);

    try {
      const encoder = await promise;
      if (encoder) this.cache.set(model, encoder);
      return encoder;
    } finally {
      this.loading.delete(encodingName);
    }
  }

  private async resolveEncoding(model: string): Promise<string> {
    try {
      const models = (await import("tiktoken/model_to_encoding.json")) as {
        default: Record<string, string>;
      };
      if (model in models.default) return models.default[model]!;
    } catch {
      // fall through
    }
    return "o200k_base";
  }

  private async loadEncoder(
    encodingName: string,
  ): Promise<Tiktoken | undefined> {
    try {
      const { Tiktoken } = await import("tiktoken/lite");
      const { load } = await import("tiktoken/load");
      const registry = (await import("tiktoken/registry.json")) as {
        default: Record<string, unknown>;
      };

      const registryInfo = registry.default[encodingName];
      if (!registryInfo) {
        logger.warn(
          { encodingName },
          "unknown tiktoken encoding, skipping tokenization",
        );
        return undefined;
      }

      const bpeData = await load(
        registryInfo as Parameters<typeof load>[0],
        async (url: string) => await this.fetchBpeRanks(url),
      );

      return new Tiktoken(
        bpeData.bpe_ranks,
        bpeData.special_tokens,
        bpeData.pat_str,
      ) as unknown as Tiktoken;
    } catch (error) {
      logger.warn(
        { error },
        "tiktoken could not be loaded, skipping tokenization",
      );
      return undefined;
    }
  }

  private async fetchBpeRanks(url: string): Promise<string> {
    const filename = path.basename(url);

    // Prevent directory traversal
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return this.remoteFetch(url);
    }

    // Try local file first if TIKTOKENS_PATH is set
    if (process.env.TIKTOKENS_PATH) {
      const localPath = path.join(process.env.TIKTOKENS_PATH, filename);
      try {
        return await fs.readFile(localPath, "utf8");
      } catch (error) {
        logger.warn(
          {
            localPath,
            error: error instanceof Error ? error.message : String(error),
          },
          "Local read failed; falling back to remote fetch",
        );
      }
    }

    return this.remoteFetch(url);
  }

  private async remoteFetch(url: string): Promise<string> {
    try {
      const nodeFetchCache = await import("node-fetch-cache");
      const cachedFetch = nodeFetchCache.default.create({
        cache: new nodeFetchCache.FileSystemCache({
          cacheDirectory: "node_modules/.cache/tiktoken",
          ttl: 1000 * 60 * 60 * 24 * 365, // 1 year
        }),
      });
      const res = await cachedFetch(url);
      return res.text();
    } catch {
      // Fall back to native fetch when node-fetch-cache is unavailable
      const res = await globalThis.fetch(url);
      return res.text();
    }
  }
}
