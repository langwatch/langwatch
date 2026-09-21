/**
 * The per-call options every mutating call on the billing surfaces takes.
 *
 * WHERE THEY GO. A call whose arguments already ride in an options bag
 * (`disable(id, { reason })`, `reset(id, { endUserId })`) gains these fields in
 * that same bag: one bag per call is what a caller expects. A call that takes a
 * request BODY (`create(input)`, `update(id, input)`) gets a separate trailing
 * parameter instead, because those body types mirror the wire verbatim and must
 * not grow keys the wire has never heard of.
 *
 * They are an interface rather than a bare `signal` so that the next thing a
 * call needs per invocation is an added field rather than an added parameter.
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
   * Makes the create safe to retry. A dropped connection after the write but
   * before the response looks exactly like a dropped request, and sending it
   * again without a key mints a SECOND resource. Send the same key on the
   * retry and the server answers with the first response instead, byte for
   * byte, including the one-time secret a create hands back.
   *
   * Any string of 8 to 255 characters; a UUID minted per logical create is the
   * usual choice. Receipts answer for 24 hours, and only successful creates
   * leave one, so a create that failed is safe to run again either way.
   *
   * Reusing a key with a DIFFERENT body is refused with `idempotency_error`
   * rather than quietly answering for the wrong request.
   */
  idempotencyKey?: string;
  /**
   * Called when the response came from a receipt rather than a fresh write,
   * i.e. this exact create had already succeeded.
   *
   * A hook rather than a field on the returned resource: the resource is
   * identical either way, so nothing about handling it changes, and the
   * distinction is something a caller logs rather than branches on. Keeping it
   * off the return type also keeps the wire-shaped entities free of fields the
   * wire does not have.
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
export function idempotentCreateInit(
  options?: IdempotentCreateOptions,
): ObservedRequestInit {
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
