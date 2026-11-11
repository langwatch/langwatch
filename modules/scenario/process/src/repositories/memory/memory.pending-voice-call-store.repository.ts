import type {
  PendingVoiceCall,
  PendingVoiceCallStoreRepository,
  TakenPendingVoiceCall,
} from "../pending-voice-call-store.repository.ts";

/** In-memory store (spike); take deletes. */
export class InMemoryPendingVoiceCallStoreRepository implements PendingVoiceCallStoreRepository {
  private readonly calls = new Map<string, PendingVoiceCall>();

  static create(): InMemoryPendingVoiceCallStoreRepository {
    return new InMemoryPendingVoiceCallStoreRepository();
  }

  add(call: PendingVoiceCall): void {
    this.calls.set(call.nonce, call);
  }

  take(nonce: string): Promise<TakenPendingVoiceCall> {
    const call = this.calls.get(nonce);
    this.calls.delete(nonce);
    return Promise.resolve(call ? { taken: true, call } : { taken: false });
  }
}
