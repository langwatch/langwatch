import {
  type EmailContent,
  EmailGateway,
  type EmailProviderName,
} from "../email-delivery.channel.ts";

/** Records what it was asked to send, so a test reads the mail back instead of a vendor. */
export class MemoryEmailGatewayChannel extends EmailGateway {
  static create(name: EmailProviderName): MemoryEmailGatewayChannel {
    return new MemoryEmailGatewayChannel(name);
  }

  readonly sent: EmailContent[] = [];
  closeCalls = 0;

  private constructor(readonly name: EmailProviderName) {
    super();
  }

  async send({ content }: { content: EmailContent; defaultFrom: string }): Promise<unknown> {
    this.sent.push(content);
    return { accepted: true };
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
  }
}
