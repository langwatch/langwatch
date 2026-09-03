import { useEffect, useState } from "react";

/**
 * The anonymous browser id used to bucket a visitor who is not signed in.
 *
 * It is a random v4 UUID and nothing else. Nothing about the machine is
 * measured or derived: no canvas, no font or hardware enumeration, no
 * network or locale probing, and no personal data. It identifies one
 * browser's storage, not a person, so clearing site data rotates it and the
 * visitor lands in fresh buckets.
 *
 * It exists so a percentage rollout can be stable for a signed-out visitor
 * across page loads. Once they sign in, the authenticated target buckets by
 * user id instead, so their answer is the same in every browser.
 */
const STORAGE_KEY = "langwatch:anonymous-id";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Used only when localStorage cannot be read or written — private-mode
 * browsers, blocked site data, quota failures. The id then lives for this
 * page alone, which costs bucket stability across navigations rather than
 * failing the page.
 */
let pageLifetimeId: string | undefined;

function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Read the stored id, or mint and persist one.
 *
 * A stored value that is not a v4 UUID is replaced rather than trusted: it
 * did not come from here, and the resolver would reject it anyway.
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
 * Subscribe to this browser's anonymous id.
 *
 * Returns undefined during server rendering and on the first client render,
 * then the real id after mount, so the markup cannot differ between the two.
 * A caller that has no id yet has no anonymous target yet, and should not
 * resolve flags until it does.
 */
export function useAnonymousId(): string | undefined {
  const [anonymousId, setAnonymousId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setAnonymousId(readAnonymousId());
  }, []);

  return anonymousId;
}
