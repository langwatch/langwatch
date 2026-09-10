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

/** How long a freshly registered nonce stays valid before it is treated as
 *  expired. A dial-back that has not arrived within the window is a call that
 *  is not coming; a longer window only widens the replay surface. */
export const VOICE_NONCE_DEFAULT_TTL_MS = 60_000;

/** The outcome of consuming a nonce: the owning child, or why it was refused. */
export type VoiceNonceLookup =
	| { ok: true; child: ChildProcess }
	| { ok: false; reason: "unknown" | "expired" };

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
		if (this._now() >= entry.expiresAt) return { ok: false, reason: "expired" };
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
