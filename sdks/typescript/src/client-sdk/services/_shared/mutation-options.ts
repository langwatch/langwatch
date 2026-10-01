/**
 * The per-call options every mutating billing call takes. An options-bag
 * call gains these fields there; a body call (`create(input)`) gets them as
 * a trailing param, since body types mirror the wire verbatim.
 */

/** The request header the control plane deduplicates creates on. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

/**
 * The response header a replayed create carries. Only ever `"true"`, and
 * ABSENT rather than false on a first execution, so its presence is the whole
 * signal.
 */
export const IDEMPOTENT_REPLAY_HEADER = "X-Idempotent-Replay";

export interface MutationOptions {
  /**
   * Cancel the call. Without one, the request is bounded by the SDK's own
   * 30 second timeout so a hung control plane fails rather than freezes.
   */
  signal?: AbortSignal;
}

export interface IdempotentCreateOptions extends MutationOptions {
  /**
   * Makes the create safe to retry: the same key replays the first
   * response verbatim, while a dropped response with no key would mint a
   * second resource. A DIFFERENT body under the same key is refused.
   */
  idempotencyKey?: string;
  /**
   * Called when the response came from a receipt, not a fresh write. A hook
   * rather than a resource field, since callers log this rather than branch
   * on it, keeping wire-shaped entities free of fields the wire lacks.
   */
  onIdempotentReplay?: () => void;
}

/** What a service's `request()` takes beyond a plain `RequestInit`. */
export interface ObservedRequestInit extends RequestInit {
  /**
   * Reads the raw response before its body is parsed. Only headers that the
   * caller asked about are read here; a service never keeps the response.
   */
  onResponse?: (response: Response) => void;
}

/** Per-call plumbing for a mutating call that is not an idempotent create. */
export function mutationInit(options?: MutationOptions): ObservedRequestInit {
  return options?.signal ? { signal: options.signal } : {};
}

/**
 * Per-call plumbing for a create the server will deduplicate: the key on the
 * way out, and the replay verdict on the way back.
 */
export function idempotentCreateInit(options?: IdempotentCreateOptions): ObservedRequestInit {
  const onIdempotentReplay = options?.onIdempotentReplay;
  return {
    ...mutationInit(options),
    ...(options?.idempotencyKey !== undefined
      ? { headers: { [IDEMPOTENCY_KEY_HEADER]: options.idempotencyKey } }
      : {}),
    ...(onIdempotentReplay
      ? {
          onResponse: (response: Response) => {
            if (response.headers.get(IDEMPOTENT_REPLAY_HEADER) === "true") {
              onIdempotentReplay();
            }
          },
        }
      : {}),
  };
}
