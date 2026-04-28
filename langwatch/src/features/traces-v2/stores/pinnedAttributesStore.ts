import { create } from "zustand";

export type PinnedAttributeSource = "attribute" | "resource";

export interface PinnedAttribute {
  source: PinnedAttributeSource;
  key: string;
  label?: string;
}

interface PinnedAttributesState {
  byProject: Record<string, PinnedAttribute[]>;
  setForProject: (projectId: string, pins: PinnedAttribute[]) => void;
  togglePin: (projectId: string, pin: PinnedAttribute) => void;
  removePin: (projectId: string, source: PinnedAttributeSource, key: string) => void;
  reorder: (projectId: string, fromIndex: number, toIndex: number) => void;
  hydrateFromStorage: (projectId: string) => void;
}

const STORAGE_PREFIX = "langwatch:traces-v2:pinned-attrs:";
// Keep room for future fields like Prisma-backed metadata; bump if shape changes.
const STORAGE_VERSION = 1;

interface StoredShape {
  version: number;
  pins: PinnedAttribute[];
}

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}${projectId}`;
}

function readFromStorage(projectId: string): PinnedAttribute[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredShape;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.pins)) {
      return [];
    }
    return parsed.pins.filter(
      (p): p is PinnedAttribute =>
        !!p &&
        typeof p.key === "string" &&
        (p.source === "attribute" || p.source === "resource"),
    );
  } catch {
    return [];
  }
}

function writeToStorage(projectId: string, pins: PinnedAttribute[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredShape = { version: STORAGE_VERSION, pins };
    localStorage.setItem(storageKey(projectId), JSON.stringify(payload));
  } catch {
    // Storage may be full or disabled; pinning gracefully degrades.
  }
}

function samePin(
  a: PinnedAttribute,
  source: PinnedAttributeSource,
  key: string,
): boolean {
  return a.source === source && a.key === key;
}

export const usePinnedAttributesStore = create<PinnedAttributesState>(
  (set, get) => ({
    byProject: {},

    setForProject: (projectId, pins) => {
      writeToStorage(projectId, pins);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: pins } }));
    },

    togglePin: (projectId, pin) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      const exists = current.some((p) => samePin(p, pin.source, pin.key));
      const next = exists
        ? current.filter((p) => !samePin(p, pin.source, pin.key))
        : [...current, pin];
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    removePin: (projectId, source, key) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      const next = current.filter((p) => !samePin(p, source, key));
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    reorder: (projectId, fromIndex, toIndex) => {
      const current = get().byProject[projectId] ?? readFromStorage(projectId);
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return;
      }
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      writeToStorage(projectId, next);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: next } }));
    },

    hydrateFromStorage: (projectId) => {
      const stored = readFromStorage(projectId);
      set((s) => ({ byProject: { ...s.byProject, [projectId]: stored } }));
    },
  }),
);

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (!event.key || !event.key.startsWith(STORAGE_PREFIX)) return;
    const projectId = event.key.slice(STORAGE_PREFIX.length);
    usePinnedAttributesStore.getState().hydrateFromStorage(projectId);
  });
}
