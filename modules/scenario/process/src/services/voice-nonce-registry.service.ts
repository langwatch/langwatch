// Voice worker's per-call nonce registry: the nonce lives in the fleet's store, single-use and
// time-boxed; the owning child and its Twilio token stay on this worker, the one Twilio dials back.

import type { ChildProcess } from "node:child_process";

import { generate } from "@langwatch/ksuid";

import type { VoiceNonceRepository } from "../repositories/voice-nonce.repository.ts";

/** How long a freshly registered nonce stays valid before it is treated as
 *  expired. A dial-back that has not arrived within the window is a call that
 *  is not coming; a longer window only widens the replay surface. */
export const VOICE_NONCE_DEFAULT_TTL_MS = 60_000;

/**
 * The outcome of consuming a nonce: the owning child and the auth token Twilio signs its
 * upgrade with, or why it was refused. An "expired" refusal still carries the child, so the
 * door can stop it waiting for the connect timeout; "unknown" has no child to notify.
 */
export type VoiceNonceLookup =
  | { ok: true; child: ChildProcess; authToken: string }
  | { ok: false; reason: "unknown" }
  | { ok: false; reason: "expired"; child: ChildProcess };

interface HeldRegistration {
  registration: string;
  child: ChildProcess;
  authToken: string;
  expiresAt: number;
}

export class VoiceNonceRegistryService {
  static create(options: {
    nonces: VoiceNonceRepository;
    ttlMs?: number;
    now?: () => number;
  }): VoiceNonceRegistryService {
    return new VoiceNonceRegistryService(
      options.nonces,
      options.ttlMs ?? VOICE_NONCE_DEFAULT_TTL_MS,
      options.now ?? Date.now,
    );
  }

  private readonly held = new Map<string, HeldRegistration>();

  private constructor(
    private readonly nonces: VoiceNonceRepository,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  /** Number of nonces this worker holds (expired-but-unconsumed included). */
  get size(): number {
    return this.held.size;
  }

  /**
   * Register a nonce against the child that owns the call and its Twilio auth token.
   * Registering the same nonce again re-arms the clock and replaces the owner.
   */
  async register(params: { nonce: string; child: ChildProcess; authToken: string }): Promise<void> {
    const registration = generate("scenario").toString();
    await this.nonces.store({
      nonce: params.nonce,
      registration,
      ttlSeconds: Math.ceil(this.ttlMs / 1000),
    });
    this.held.set(params.nonce, {
      registration,
      child: params.child,
      authToken: params.authToken,
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /**
   * Consume a nonce: single-use, so the store's entry is taken whether or not it had expired,
   * and a replay reads as unknown. A nonce this worker never registered is unknown here even
   * when the store held it, since only the registering worker holds the child.
   */
  async consume(nonce: string): Promise<VoiceNonceLookup> {
    const held = this.held.get(nonce);
    this.held.delete(nonce);
    const taken = await this.nonces.take(nonce);
    if (!held) return { ok: false, reason: "unknown" };
    if (this.now() >= held.expiresAt) return { ok: false, reason: "expired", child: held.child };
    if (!taken.taken || taken.registration !== held.registration) {
      return { ok: false, reason: "unknown" };
    }
    return { ok: true, child: held.child, authToken: held.authToken };
  }

  /** Drop a nonce without consuming it (e.g. the call was abandoned). */
  async discard(nonce: string): Promise<void> {
    this.held.delete(nonce);
    await this.nonces.discard(nonce);
  }
}
