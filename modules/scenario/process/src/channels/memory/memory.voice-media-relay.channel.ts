import type {
  VoiceMediaRelay,
  VoiceMediaRelayChannel,
  VoiceMediaRelayCredential,
  VoiceMediaRelayEnd,
  VoiceMediaRelayFrame,
  VoiceMediaRelayOpenResult,
  VoiceMediaRelayRefusal,
} from "../voice-media-relay.channels.ts";

type JoinOutcome = Awaited<VoiceMediaRelay["joined"]>;

/** A relay held in memory; a test plays Twilio with `join`, `twilioSends` and `end`. */
export class MemoryVoiceMediaRelay implements VoiceMediaRelay {
  readonly logId: string;
  readonly streamUrl: string;
  readonly joined: Promise<JoinOutcome>;
  /** Frames the worker sent to Twilio. */
  readonly sentToTwilio: VoiceMediaRelayFrame[] = [];
  /** How the relay ended, once it has. */
  ended: VoiceMediaRelayEnd | undefined;
  private settleJoin: (outcome: JoinOutcome) => void = () => undefined;
  private isJoined = false;
  private readonly early: VoiceMediaRelayFrame[] = [];
  private frameHandler: ((frame: VoiceMediaRelayFrame) => void) | undefined;
  private readonly endHandlers: ((end: VoiceMediaRelayEnd) => void)[] = [];

  constructor(relayId: string) {
    this.logId = relayId.slice(0, 8);
    this.streamUrl = `wss://gateway.example.test/v1/voice/twilio/${relayId}`;
    this.joined = new Promise((resolve) => {
      this.settleJoin = resolve;
    });
  }

  /** Twilio joins, signing its upgrade with `twilioSignature`. */
  join(input: { twilioSignature?: string } = {}): void {
    this.isJoined = true;
    this.settleJoin({ joined: true, twilioSignature: input.twilioSignature });
  }

  twilioSends(frame: VoiceMediaRelayFrame): void {
    if (this.frameHandler) this.frameHandler(frame);
    else this.early.push(frame);
  }

  /** The gateway ends the relay. */
  end(end: VoiceMediaRelayEnd): void {
    if (this.ended) return;
    this.ended = end;
    if (!this.isJoined) this.settleJoin({ joined: false, end });
    for (const handler of this.endHandlers.splice(0)) handler(end);
  }

  onFrame(handler: (frame: VoiceMediaRelayFrame) => void): void {
    this.frameHandler = handler;
    for (const frame of this.early.splice(0)) handler(frame);
  }

  send(frame: VoiceMediaRelayFrame): void {
    if (!this.ended) this.sentToTwilio.push(frame);
  }

  onEnd(handler: (end: VoiceMediaRelayEnd) => void): void {
    if (this.ended) handler(this.ended);
    else this.endHandlers.push(handler);
  }

  close(end: VoiceMediaRelayEnd): void {
    this.end(end);
  }
}

/** Opens memory relays, or refuses every open with `refusal`; records the credentials it saw. */
export class MemoryVoiceMediaRelayChannel implements VoiceMediaRelayChannel {
  readonly opened: MemoryVoiceMediaRelay[] = [];
  readonly credentials: VoiceMediaRelayCredential[] = [];

  static create(options: { refusal?: VoiceMediaRelayRefusal } = {}): MemoryVoiceMediaRelayChannel {
    return new MemoryVoiceMediaRelayChannel(options.refusal);
  }

  private constructor(private readonly refusal?: VoiceMediaRelayRefusal) {}

  async open({
    credential,
  }: {
    credential: VoiceMediaRelayCredential;
  }): Promise<VoiceMediaRelayOpenResult> {
    this.credentials.push(credential);
    if (this.refusal) return { opened: false, refusal: this.refusal };
    const relay = new MemoryVoiceMediaRelay(`relay-${this.opened.length + 1}-0123456789`);
    this.opened.push(relay);
    return { opened: true, relay };
  }
}
