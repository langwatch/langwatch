/**
 * The per-call options every mutating call on the billing surfaces takes.
 * A call with an options bag (`disable(id, { reason })`) gains these fields
 * there; a call with a request BODY (`create(input)`) gets them as a
 * separate trailing param, since body types mirror the wire verbatim. An
 * interface, not a bare `signal`, so a new field never needs a new param.
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
   * Makes the create safe to retry: resending without a key after a dropped
   * response would mint a second resource, but the same key replays the
   * first response verbatim (including its one-time secret). Any 8-255 char
   * string; a UUID per logical create is typical. Reusing a key with a
   * DIFFERENT body is refused with `idempotency_error` rather than answering
   * for the wrong request.
   */
  idempotencyKey?: string;
  /**
   * Called when the response came from a receipt, not a fresh write. A hook
   * rather than a field on the resource: the resource is identical either
   * way (callers log this, not branch on it), and it keeps wire-shaped
   * entities free of fields the wire does not have.
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
