import type { ChildProcess } from "node:child_process";

import type { VoiceNonceRegistryService } from "../../services/voice-nonce-registry.service.ts";
import type { ReceivedVoiceSocket, VoiceSocketReceiver } from "../voice-socket-handoff.channels.ts";

/**
 * The child's half of the nonce handoff, in one process: a registration lands in the
 * parent's registry directly, and a delivered socket reaches the receiver's handler.
 */
export class MemoryVoiceNonceHandoffChannel implements VoiceSocketReceiver {
  static create(input: {
    registry: VoiceNonceRegistryService;
    child: ChildProcess;
  }): MemoryVoiceNonceHandoffChannel {
    return new MemoryVoiceNonceHandoffChannel(input.registry, input.child);
  }

  readonly #handlers = new Set<(received: ReceivedVoiceSocket) => void>();

  private constructor(
    private readonly registry: VoiceNonceRegistryService,
    private readonly child: ChildProcess,
  ) {}

  registerNonce = async (input: { nonce: string }): Promise<void> => {
    await this.registry.register({ nonce: input.nonce, child: this.child });
  };

  raceUpgradeRefusal = <T>(promise: Promise<T>): Promise<T> => promise;

  onVoiceSocket(handler: (received: ReceivedVoiceSocket) => void): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  deliver(received: ReceivedVoiceSocket): void {
    for (const handler of this.#handlers) handler(received);
  }
}
