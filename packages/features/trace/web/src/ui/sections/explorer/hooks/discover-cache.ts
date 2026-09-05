/**
 * Per-project cache of the last successful `tracesV2.discover` response.
 */
import type { RouterOutputs } from "../../trace-api";

const STORAGE_KEY = "langwatch:traces-v2:discoverCache";
const TTL_MS = 24 * 60 * 60 * 1000;

export type DiscoverDescriptors = RouterOutputs["tracesV2"]["discover"]["facets"];

interface Entry {
  facets: DiscoverDescriptors;
  savedAt: number;
}

type Cache = Record<string, Entry>;

function load(): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Cache;
  } catch {
    return {};
  }
}

function persist(cache: Cache): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be full / disabled. The in-memory cache still
    // works for the rest of the session; we just don't survive a
    // reload, which is preferable to throwing into the render path.
  }
}

const memory: Cache = load();

function isValidEntry(entry: unknown): entry is Entry {
  // Persisted via JSON.parse → could be anything if a sibling tab or a
  // pre-rename version of the app wrote into the same key. We only need
  // the two fields the rest of the cache touches.
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Partial<Entry>;
  return typeof e.savedAt === "number" && e.facets !== undefined;
}

export function getCachedDiscover(projectId: string): DiscoverDescriptors | null {
  const entry = memory[projectId];
  if (!isValidEntry(entry)) {
    if (entry !== undefined) {
      delete memory[projectId];
      persist(memory);
    }
    return null;
  }
  if (Date.now() - entry.savedAt > TTL_MS) {
    delete memory[projectId];
    persist(memory);
    return null;
  }
  return entry.facets;
}

export function setCachedDiscover({
  projectId,
  facets,
}: {
  projectId: string;
  facets: DiscoverDescriptors;
}): void {
  memory[projectId] = { facets, savedAt: Date.now() };
  persist(memory);
}
