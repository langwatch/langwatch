/**
 * The voice worker's per-call nonce registry.
 *
 * A phone job, running in the parent worker process, mints a single-use nonce
 * and registers it here against the scenario child it spawned, then tells Twilio
 * to dial back `wss://<host>/twilio/<nonce>`. When that upgrade arrives, the
 * media listener {@link ../workers/voice-ws-listener} consumes the nonce and
 * hands the raw socket to the owning child.
 *
 * Nonces are single-use and time-boxed: a call that never connects leaves no
 * open door, and a replayed nonce finds nothing. Registering the child is
 * slice 2's job (the phone runner); this registry and the listener that reads
 * it are slice 3, and both are inert until a phone job registers a nonce.
 */

import type { ChildProcess } from "node:child_process";

/**
 * The SDK's own budget for `placeCall`/`waitForCall` to wait for the Media
 * Streams socket to CONNECT (`DEFAULT_STREAM_CONNECT_TIMEOUT_MS` in the
 * vendored `@langwatch/scenario` SDK's `twilio-shared.ts`). Twilio may ring
 * the callee for tens of seconds before either side answers, so this covers
 * ring time PLUS the socket connect, not just the connect — a real
 * production call was observed with a 55s TwiML `<Dial timeout>` alone.
 *
 * Mirrored here rather than imported: the SDK source already exports this
 * value, but the platform currently consumes a vendored tarball snapshot
 * (`platform/app/vendor/langwatch-scenario-*.tgz`) that predates the export,
 * the same situation `TWILIO_MAX_CALL_DURATION_CAP_SECONDS` in
 * `transports/phone.transport.ts` documents for the call-duration cap. Keep
 * this in step with the SDK's constant on the next vendor bump (or switch to
 * importing it once the vendored package includes it).
 */
export const SDK_STREAM_CONNECT_TIMEOUT_MS = 120_000;

/**
 * How long a freshly registered nonce stays valid before it is treated as
 * expired.
 *
 * MUST stay >= {@link SDK_STREAM_CONNECT_TIMEOUT_MS}: the nonce is registered
 * BEFORE `placeCall` is even invoked (the whole point of the registration
 * handshake, see `voice-nonce-handoff.ts`), and Twilio's dial-back can
 * legitimately arrive any time up to that full connect-wait window later. A
 * TTL shorter than that window expires a nonce for a call that is still
 * correctly ringing — the listener then refuses a real, on-time dial-back
 * with a 403, and the adapter burns its entire remaining wait before failing
 * with a misleading "stream never connected" rather than the true cause
 * (this exact failure shape was observed in production). The `+30_000`
 * headroom absorbs the registration IPC round trip and clock/scheduling
 * jitter between `register()` and the SDK's own wait actually starting — it
 * is not part of the correctness argument above, only a safety margin on top
 * of it. Do not lower this constant without raising
 * {@link SDK_STREAM_CONNECT_TIMEOUT_MS} (or the SDK's own default) to match.
 */
export const VOICE_NONCE_DEFAULT_TTL_MS = SDK_STREAM_CONNECT_TIMEOUT_MS + 30_000;

/**
 * The outcome of consuming a nonce: the owning child, or why it was refused.
 * An "expired" refusal still carries the owning `child` — unlike "unknown",
 * where no child was ever associated — so the caller (the listener) can send
 * that child a best-effort refusal notice instead of leaving it to burn its
 * full connect-wait timeout for a socket that will never arrive authorized.
 */
export type VoiceNonceLookup =
  | { ok: true; child: ChildProcess }
  | { ok: false; reason: "unknown" }
  | { ok: false; reason: "expired"; child: ChildProcess };

interface RegisteredNonce {
  child: ChildProcess;
  expiresAt: number;
}

/**
 * An in-memory map of live nonces. One instance per worker process - the
 * listener and the phone jobs share it through {@link getVoiceNonceRegistry}.
 */
export class VoiceNonceRegistry {
  private readonly _byNonce = new Map<string, RegisteredNonce>();
  private readonly _ttlMs: number;
  private readonly _now: () => number;

  constructor(options?: { ttlMs?: number; now?: () => number }) {
    this._ttlMs = options?.ttlMs ?? VOICE_NONCE_DEFAULT_TTL_MS;
    this._now = options?.now ?? Date.now;
  }

  /** Number of nonces currently registered (expired-but-unconsumed included). */
  get size(): number {
    return this._byNonce.size;
  }

  /**
   * Register a nonce against the child that owns the call. Overwrites any
   * existing entry for the same nonce, so a re-registration re-arms the clock.
   */
  register(params: { nonce: string; child: ChildProcess }): void {
    this._byNonce.set(params.nonce, {
      child: params.child,
      expiresAt: this._now() + this._ttlMs,
    });
  }

  /**
   * Consume a nonce: single-use, so a matched nonce is removed whether or not
   * it had expired. Returns the owning child on a hit within the window, or the
   * reason it was refused. An expired hit is still removed, so a later replay
   * reads as unknown rather than expired.
   */
  consume(nonce: string): VoiceNonceLookup {
    const entry = this._byNonce.get(nonce);
    if (!entry) return { ok: false, reason: "unknown" };
    this._byNonce.delete(nonce);
    if (this._now() >= entry.expiresAt) {
      return { ok: false, reason: "expired", child: entry.child };
    }
    return { ok: true, child: entry.child };
  }

  /** Drop a nonce without consuming it (e.g. the call was abandoned). */
  discard(nonce: string): void {
    this._byNonce.delete(nonce);
  }
}

let _registry: VoiceNonceRegistry | null = null;

/** The process-wide registry the listener reads and phone jobs write. */
export function getVoiceNonceRegistry(): VoiceNonceRegistry {
  _registry ??= new VoiceNonceRegistry();
  return _registry;
}
