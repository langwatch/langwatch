import type { VoicePublicUrlTunnel } from "../voice-public-url-tunnel.channels.ts";

/** Opens no network tunnel: answers a fixed origin, or fails with a fixed reason. */
export class MemoryVoicePublicUrlTunnelChannel {
  static create(answer: { url: string } | { failure: string }): MemoryVoicePublicUrlTunnelChannel {
    return new MemoryVoicePublicUrlTunnelChannel(answer);
  }

  readonly openedPorts: number[] = [];
  closed = 0;

  private constructor(private readonly answer: { url: string } | { failure: string }) {}

  open = async (input: { port: number }): Promise<VoicePublicUrlTunnel> => {
    this.openedPorts.push(input.port);
    if ("failure" in this.answer) throw new Error(this.answer.failure);
    return {
      url: this.answer.url,
      close: async () => {
        this.closed += 1;
      },
    };
  };
}
