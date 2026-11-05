import type {
  RelayedUpgrade,
  VoiceMediaRelay,
  VoiceMediaRelayBridgeChannel,
} from "../voice-media-relay.channels.ts";

type Bridged = {
  relay: VoiceMediaRelay;
  path: string;
  twilioSignature: string | undefined;
  onUpgrade: (upgrade: RelayedUpgrade) => void;
};

/** Records the relays it was asked to bridge; no socket is opened and no upgrade is made. */
export class MemoryVoiceMediaRelayBridgeChannel implements VoiceMediaRelayBridgeChannel {
  readonly bridged: Bridged[] = [];

  static create(): MemoryVoiceMediaRelayBridgeChannel {
    return new MemoryVoiceMediaRelayBridgeChannel();
  }

  private constructor() {}

  async bridge(input: Bridged): Promise<void> {
    this.bridged.push(input);
  }
}
