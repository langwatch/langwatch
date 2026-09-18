import { useEffect, useState } from "react";

/**
 * Random v4 UUID for non-signed-in visitor (stable across page loads for
 * percentage rollouts; clears with site data).
 */
const STORAGE_KEY = "langwatch:anonymous-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Used only when localStorage cannot be read or written (private-mode,
 * blocked site data, quota failures) — the id then lives for this page
 * alone, trading bucket stability for not failing the page.
 */
let pageLifetimeId: string | undefined;

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Read the stored id, or mint and persist one. A stored value that is not
 * a v4 UUID is replaced rather than trusted — it didn't come from here,
 * and the resolver would reject it anyway.
 */
export function readAnonymousId(): string | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && UUID_PATTERN.test(stored)) return stored;

    const minted = generateId();
    localStorage.setItem(STORAGE_KEY, minted);
    return minted;
  } catch {
    pageLifetimeId ??= generateId();
    return pageLifetimeId;
  }
}

/**
 * Subscribe to this browser's anonymous id. Undefined during server
 * rendering and the first client render (so markup can't differ), then
 * the real id after mount — callers should not resolve flags before that.
 */
export function useAnonymousId(): string | undefined {
  const [anonymousId, setAnonymousId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setAnonymousId(readAnonymousId());
  }, []);

  return anonymousId;
}
