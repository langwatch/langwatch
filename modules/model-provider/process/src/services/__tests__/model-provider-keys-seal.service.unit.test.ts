/** @vitest-environment node */
import { Temporal, type Instant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { ModelProviderRepository } from "../../repositories/model-provider.repository.ts";
import {
  ModelProviderKeysSealService,
  type ModelProviderKeysSealReport,
} from "../model-provider-keys-seal.service.ts";

/** The stand-in store seals as the column does: three colon-separated segments. */
const sealedOf = (keys: unknown) =>
  `iv:${Buffer.from(JSON.stringify(keys), "utf8").toString("hex")}:tag`;

type StoredRow = { id: string; customKeys: unknown; updatedAt: Instant };

/** `beforeWrite` lands a save between the step's read and its guarded write. */
function storeOver(
  rows: { id: string; customKeys: unknown }[],
  { beforeWrite }: { beforeWrite?: (row: StoredRow) => void } = {},
) {
  const stored: StoredRow[] = rows.map((row) => ({
    ...row,
    updatedAt: Temporal.Instant.fromEpochMilliseconds(0),
  }));
  const writes: string[] = [];
  const saved: ModelProviderKeysSealReport[] = [];
  let listings = 0;
  const providers: Pick<
    ModelProviderRepository,
    "findProjectScopedLegacyColumns" | "updateLegacyColumnsIfUnchanged"
  > = {
    findProjectScopedLegacyColumns: async () => {
      listings += 1;
      return stored.map((row) => ({
        ...row,
        provider: "openai",
        customModels: null,
        customEmbeddingsModels: null,
      }));
    },
    updateLegacyColumnsIfUnchanged: async ({ id, customKeys, updatedAt }) => {
      const row = stored.find((candidate) => candidate.id === id);
      if (row === undefined) return false;
      beforeWrite?.(row);
      if (!row.updatedAt.equals(updatedAt)) return false;
      writes.push(id);
      row.customKeys = sealedOf(customKeys);
      row.updatedAt = row.updatedAt.add({ milliseconds: 1 });
      return true;
    },
  };
  const run = (input: { dryRun?: boolean; afterId?: string } = {}) =>
    ModelProviderKeysSealService.create({ providers }).sealPlaintextKeys({
      dryRun: input.dryRun ?? false,
      signal: new AbortController().signal,
      afterId: input.afterId ?? null,
      onRowDone: (report) => {
        saved.push(report);
        return Promise.resolve();
      },
    });

  return { run, stored, writes, saved, listings: () => listings };
}

const plaintext = [
  { id: "mp_1", customKeys: { OPENAI_API_KEY: "sk-one" } },
  { id: "mp_2", customKeys: { ANTHROPIC_API_KEY: "sk-two" } },
];

const touch = (row: StoredRow) => {
  row.updatedAt = row.updatedAt.add({ milliseconds: 1 });
};

describe("the model provider key sealing step", () => {
  /** @scenario "Migration encrypts existing plaintext keys" */
  it("seals every plaintext row, saving progress after each", async () => {
    const { run, stored, saved } = storeOver(plaintext);

    const report = await run();

    expect(report).toEqual({ afterId: "mp_2", updated: 2, skipped: 0 });
    expect(saved.map((entry) => entry.afterId)).toEqual(["mp_1", "mp_2"]);
    expect(JSON.stringify(stored)).not.toContain("sk-");
  });

  /** @scenario "Migration is idempotent" */
  it("writes nothing on a second pass", async () => {
    const { run, writes } = storeOver(plaintext);

    await run();
    const second = await run();

    expect(second).toEqual({ afterId: null, updated: 0, skipped: 2 });
    expect(writes).toEqual(["mp_1", "mp_2"]);
  });

  /** @scenario "The key sealing step resumes after its last sealed row, and a dry run writes nothing" */
  it("writes and saves nothing on a dry run, then resumes after the saved row", async () => {
    const { run, writes, saved } = storeOver(plaintext);

    const dry = await run({ dryRun: true });
    expect(dry.updated).toBe(2);
    expect(writes).toEqual([]);
    expect(saved).toEqual([]);

    await run({ afterId: "mp_1" });
    expect(writes).toEqual(["mp_2"]);
  });

  /** @scenario "The legacy credential and custom-model migrations read only provider rows" */
  it("reads every project-scoped provider in one listing of its own table", async () => {
    const { run, listings } = storeOver(plaintext);

    await run();

    expect(listings()).toBe(1);
  });

  /** @scenario "A model provider saved while its keys are being sealed keeps the newer save" */
  it("keeps keys saved between its read and its write, and still seals a row edited otherwise", async () => {
    const newer = sealedOf({ OPENAI_API_KEY: "sk-newer" });
    const { run, stored, writes } = storeOver(plaintext, {
      beforeWrite: (row) => {
        if (row.id === "mp_1" && row.customKeys !== newer) {
          row.customKeys = newer;
          touch(row);
        }
      },
    });

    const report = await run();

    expect(stored.find((row) => row.id === "mp_1")?.customKeys).toBe(newer);
    expect(writes).toEqual(["mp_2"]);
    expect(report).toEqual({ afterId: "mp_2", updated: 1, skipped: 1 });
  });

  /** @scenario "A model provider changed during sealing whose keys are still plaintext holds the key sealing step" */
  it("seals the other rows, saves no progress past the held row, and fails the pass", async () => {
    const { run, writes, saved } = storeOver(plaintext, {
      beforeWrite: (row) => {
        if (row.id === "mp_1") touch(row);
      },
    });

    await expect(run()).rejects.toThrow(Error);
    expect(writes).toEqual(["mp_2"]);
    expect(saved).toEqual([]);
  });
});
