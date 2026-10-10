import { useSyncExternalStore } from "react";

const STORAGE_KEY = "experiments-list-primary-metric";

type Picks = Record<string, string>;

const NO_PICKS: Picks = Object.freeze({});

/** Keeps only string values of a plain object; anything else (null, array, number) is no picks. */
function parsePicks(raw: string | null): Picks {
  if (!raw) return NO_PICKS;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return NO_PICKS;
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return NO_PICKS;
  }
}

const readRaw = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

/** Picks that could not be saved (quota, private mode): kept for this session only. */
let unsaved: Picks | undefined;
let cache: { raw: string | null; picks: Picks } = { raw: null, picks: NO_PICKS };
const listeners = new Set<() => void>();

function snapshot(): Picks {
  if (unsaved) return unsaved;
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, picks: parsePicks(raw) };
  return cache.picks;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Reads the stored blob at write time, so two quick picks in different rows keep each other's. */
function write(update: (current: Picks) => Picks) {
  const next = update(snapshot());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    unsaved = undefined;
  } catch {
    unsaved = next;
  }
  for (const listener of listeners) listener();
}

/**
 * The evaluator a person picked to lead each experiment's row, kept in this browser only
 * (nothing on the server stores it), keyed by project and experiment. Whatever the storage holds
 * is validated; when it cannot be written the pick still holds for the session.
 */
export function usePrimaryMetricChoice({
  projectId,
  experimentId,
}: {
  projectId: string;
  experimentId: string;
}) {
  const picks = useSyncExternalStore(subscribe, snapshot, () => NO_PICKS);
  const key = `${projectId}/${experimentId}`;
  const chosenKey = picks[key];

  const choose = (metricKey: string | undefined) => {
    write((current) => {
      const { [key]: _dropped, ...rest } = current;
      return metricKey === undefined ? rest : { ...rest, [key]: metricKey };
    });
  };

  return { chosenKey, choose };
}
