// Slice 1 spike for https://github.com/langwatch/tasks/issues/1002: a nonce can be taken once.

/** A call waiting to be claimed (spike). */
export interface PendingVoiceCall {
  nonce: string;
}

/** What taking a nonce found: the pending call, answered at most once. */
export type TakenPendingVoiceCall = { taken: true; call: PendingVoiceCall } | { taken: false };

/** Single-use lookup of pending calls (spike). */
export interface PendingVoiceCallStoreRepository {
  take(nonce: string): Promise<TakenPendingVoiceCall>;
}
