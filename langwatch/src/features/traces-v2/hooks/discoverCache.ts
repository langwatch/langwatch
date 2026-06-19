/**
 * Per-project cache of the last successful `tracesV2.discover` response.
 *
 * Keeps the facet sidebar useful from the first paint on every visit
 * after the first one — instead of seeding a "loading" sidebar with
 * synthesised defaults and then popping in real data 1–2 seconds later,
 * the sidebar renders the previous session's descriptors immediately
 * and quietly swaps in the live response once it lands.
 *
 * The cache is keyed by `projectId` and expires after {@link TTL_MS} so
 * a project whose schema has drifted (new evaluators added, attributes
 * deprecated) eventually shows the real shape rather than stale data
 * forever. Cleared completely if the localStorage payload won't parse
 * — better to fall through to the live query than crash on a corrupt
 * persisted state.
 */
import type { RouterOutputs } from "~/utils/api";

const STORAGE_KEY = "langwatch:traces-v2:discoverCache";
const TTL_MS = 24 * 60 * 60 * 1000;

export type DiscoverDescriptors =
  RouterOutputs["tracesV2"]["discover"]["facets"];

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

let memory: Cache = load();

function isValidEntry(entry: unknown): entry is Entry {
  // Persisted via JSON.parse → could be anything if a sibling tab or a
  // pre-rename version of the app wrote into the same key. We only need
  // the two fields the rest of the cache touches.
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Partial<Entry>;
  return typeof e.savedAt === "number" && e.facets !== undefined;
}

export function getCachedDiscover(
  projectId: string,
): DiscoverDescriptors | null {
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
