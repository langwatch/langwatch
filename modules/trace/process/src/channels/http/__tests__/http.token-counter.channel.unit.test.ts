import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpTokenCounterChannel } from "../http.token-counter.channel.ts";

const byteRanks = Array.from(
  { length: 256 },
  (_, rank) => `${Buffer.from([rank]).toString("base64")} ${rank}`,
).join("\n");

describe("HttpTokenCounterChannel", () => {
  let directory: string;
  let fetched: string[];
  let channel: HttpTokenCounterChannel | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "tiktoken-"));
    fetched = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      throw new Error("offline");
    });
  });

  afterEach(async () => {
    await channel?.close();
    channel = undefined;
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  });

  describe("given TIKTOKENS_PATH holds the o200k_base table", () => {
    beforeEach(async () => {
      await writeFile(path.join(directory, "o200k_base.tiktoken"), byteRanks);
    });

    /** @scenario "The tokenizer's local BPE directory is preferred over the network" */
    it("counts from the local table and fetches nothing", async () => {
      channel = HttpTokenCounterChannel.create({
        bpeDirectory: directory,
        fetchTimeoutMs: undefined,
      });

      await expect(channel.computeTokenCount("openai/gpt-5-mini", "hello")).resolves.toBe(5);
      expect(fetched).toEqual([]);
    });

    /** @scenario "A model the tokenizer does not know is counted with o200k_base" */
    it("counts an unknown model with o200k_base", async () => {
      channel = HttpTokenCounterChannel.create({
        bpeDirectory: directory,
        fetchTimeoutMs: undefined,
      });

      await expect(channel.computeTokenCount("acme/unknown-model", "hi")).resolves.toBe(2);
    });
  });

  /** @scenario "Encoding tables that cannot be loaded answer cannot count" */
  it("answers undefined when the table can neither be read nor fetched", async () => {
    channel = HttpTokenCounterChannel.create({
      bpeDirectory: directory,
      fetchTimeoutMs: undefined,
    });

    await expect(channel.computeTokenCount("gpt-5-mini", "hello")).resolves.toBeUndefined();
    expect(fetched).toEqual([
      "https://openaipublic.blob.core.windows.net/encodings/o200k_base.tiktoken",
    ]);
  });

  /** @scenario "A remote BPE fetch cannot hang the process" */
  it("abandons a hanging fetch after the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason));
        }),
    );
    channel = HttpTokenCounterChannel.create({ bpeDirectory: undefined, fetchTimeoutMs: "20" });

    await expect(channel.computeTokenCount("gpt-5-mini", "hello")).resolves.toBeUndefined();
  });

  it("answers undefined for empty text without loading a table", async () => {
    channel = HttpTokenCounterChannel.create({
      bpeDirectory: undefined,
      fetchTimeoutMs: undefined,
    });

    await expect(channel.computeTokenCount("gpt-5-mini", "")).resolves.toBeUndefined();
    await expect(channel.computeTokenCount("gpt-5-mini", undefined)).resolves.toBeUndefined();
    expect(fetched).toEqual([]);
  });
});
