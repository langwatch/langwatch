import { describe, expect, it, vi } from "vitest";
import {
  FeatureFlagCachePort,
  type FeatureFlagCacheSlot,
} from "../src/ports/feature-flag-cache.port";
import { MemoryFeatureFlagRepository } from "../src/repositories/memory/feature-flag.repository";
import { CachedFeatureFlagRowAdapter } from "../src/adapters/cached.feature-flag-row.adapter";

class RecordingCache extends FeatureFlagCachePort {
  readonly values = new Map<string, FeatureFlagCacheSlot>();
  readonly deleted: string[] = [];

  async tryGet(key: string): Promise<FeatureFlagCacheSlot | undefined> {
    return this.values.get(key);
  }

  async set(key: string, slot: FeatureFlagCacheSlot): Promise<void> {
    this.values.set(key, slot);
  }

  async delete(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
  }
}

function createHarness() {
  let now = 0;
  const repository = MemoryFeatureFlagRepository.create(() => now);
  const cache = new RecordingCache();
  const store = CachedFeatureFlagRowAdapter.create({ repository, cache, now: () => now });

  return {
    cache,
    repository,
    store,
    advanceBy: (durationMs: number) => {
      now += durationMs;
    },
  };
}

async function writeRow(
  repository: MemoryFeatureFlagRepository,
  key: string,
  enabled: boolean,
): Promise<void> {
  await repository.upsertEnabled({ key, enabled, lastEditedBy: "operator" });
}

describe("CachedFeatureFlagRowAdapter", () => {
  it("holds a repository row locally for five seconds, then reads it again", async () => {
    const harness = createHarness();
    await writeRow(harness.repository, "flag", false);
    const find = vi.spyOn(harness.repository, "tryFindByKey");

    await expect(harness.store.tryGetRow("flag")).resolves.toMatchObject({ enabled: false });
    await writeRow(harness.repository, "flag", true);
    harness.cache.values.clear();
    await expect(harness.store.tryGetRow("flag")).resolves.toMatchObject({ enabled: false });

    harness.advanceBy(5_000);
    await expect(harness.store.tryGetRow("flag")).resolves.toMatchObject({ enabled: true });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("uses a shared-cache hit without reading the repository", async () => {
    const harness = createHarness();
    harness.cache.values.set("flag", { row: { enabled: true, rules: [] } });
    const find = vi.spyOn(harness.repository, "tryFindByKey");

    await expect(harness.store.tryGetRow("flag")).resolves.toMatchObject({ enabled: true });
    expect(find).not.toHaveBeenCalled();
  });

  it("falls back to an absent row when the repository read fails", async () => {
    const harness = createHarness();
    vi.spyOn(harness.repository, "tryFindByKey").mockRejectedValueOnce(new Error("offline"));

    await expect(harness.store.tryGetRow("flag")).resolves.toBeNull();
  });

  it("invalidates both cache tiers before the next read", async () => {
    const harness = createHarness();
    await writeRow(harness.repository, "flag", false);
    await harness.store.tryGetRow("flag");
    await writeRow(harness.repository, "flag", true);

    await harness.store.invalidate("flag");

    await expect(harness.store.tryGetRow("flag")).resolves.toMatchObject({ enabled: true });
    expect(harness.cache.deleted).toEqual(["flag"]);
  });

  it("prunes the oldest local row when the process cache exceeds its bound", async () => {
    const harness = createHarness();
    const find = vi.spyOn(harness.repository, "tryFindByKey");

    for (let index = 0; index <= 5_000; index += 1) {
      const key = `flag-${index}`;
      await writeRow(harness.repository, key, true);
      await harness.store.tryGetRow(key);
    }
    harness.cache.values.clear();
    find.mockClear();

    await harness.store.tryGetRow("flag-5000");
    await harness.store.tryGetRow("flag-0");

    expect(find).toHaveBeenCalledOnce();
    expect(find).toHaveBeenCalledWith("flag-0");
  });
});
