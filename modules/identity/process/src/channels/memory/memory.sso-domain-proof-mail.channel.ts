import type { SsoDomainProofMail } from "../sso-domain-proof-mail.channel.ts";
import { SsoDomainProofMailChannel } from "../sso-domain-proof-mail.channel.ts";

type Sent<Name extends keyof SsoDomainProofMail> = Parameters<SsoDomainProofMail[Name]>[0];

/** Records each domain-proof mail it is handed and sends nothing. */
export class MemorySsoDomainProofMailChannel extends SsoDomainProofMailChannel {
  static create(): MemorySsoDomainProofMailChannel {
    return new MemorySsoDomainProofMailChannel();
  }

  readonly wavering: Sent<"sendProofWavering">[] = [];
  readonly lapsed: Sent<"sendProofLapsed">[] = [];

  private constructor() {
    super();
  }

  async sendProofWavering(input: Sent<"sendProofWavering">): Promise<void> {
    this.wavering.push(input);
  }

  async sendProofLapsed(input: Sent<"sendProofLapsed">): Promise<void> {
    this.lapsed.push(input);
  }
}
