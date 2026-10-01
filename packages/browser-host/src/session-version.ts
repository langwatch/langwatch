/**
 * The session-version stamp: every tRPC answer names the version of the
 * caller's session state, and a newer one than was seen marks every read
 * stale. ADR-164.
 */

/** The response header the API stamps on every tRPC answer. */
export const SESSION_VERSION_HEADER = "x-lw-session-version";

/** A stamp parses as a non-negative integer; anything else is no stamp at all. */
export function parseSessionVersion(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return;
  return Number(value);
}

/** Tracks the newest stamp seen and tells every listener each time a newer one arrives. */
export class SessionVersionWatch {
  #seen: number | undefined;
  readonly #listeners = new Set<() => void>();

  private constructor() {}

  static create(): SessionVersionWatch {
    return new SessionVersionWatch();
  }

  /** Registers a listener for each newer stamp; returns its removal. */
  onNewer(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  }

  /** The first stamp is the baseline; a reload revalidates what it restored instead. */
  observe(value: string | null): void {
    const received = parseSessionVersion(value);
    if (received === undefined) return;
    const seen = this.#seen;
    if (seen !== undefined && received <= seen) return;
    this.#seen = received;
    if (seen === undefined) return;
    for (const listener of this.#listeners) listener();
  }
}

/** A fetch that hands every answer's stamp to the watch; passed as the transport's `fetch`. */
export function sessionVersionFetch({
  fetch = globalThis.fetch,
  watch,
}: {
  fetch?: typeof globalThis.fetch;
  watch: SessionVersionWatch;
}): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    watch.observe(response.headers.get(SESSION_VERSION_HEADER));
    return response;
  };
}

/** True for a tRPC client failure the server answered 403. */
export function isForbiddenAnswer(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("data" in error)) return false;
  const { data } = error;
  return (
    typeof data === "object" && data !== null && "httpStatus" in data && data.httpStatus === 403
  );
}
