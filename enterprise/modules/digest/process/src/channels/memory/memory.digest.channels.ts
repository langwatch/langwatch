// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DigestMailChannel, type RenderedDigestMail } from "../digest-mail.channel.ts";
import type { DigestChannels } from "../digest.channels.ts";

/** Every weekly email recorded in-process instead of sent. */
export class MemoryDigestChannels {
  static readonly requires = [] as const;

  static create(): DigestChannels {
    return { mail: MemoryDigestMailChannel.create() };
  }
}

/** Records every email exactly as handed over, repeats included, so a double send shows. */
export class MemoryDigestMailChannel extends DigestMailChannel {
  static create(): MemoryDigestMailChannel {
    return new MemoryDigestMailChannel();
  }

  readonly sent: RenderedDigestMail[] = [];
  #failNext = false;

  private constructor() {
    super();
  }

  /** The next email is taken, then the call fails: a connection lost after the mailer accepted. */
  failAfterAccepting(): void {
    this.#failNext = true;
  }

  send(mail: RenderedDigestMail): Promise<void> {
    this.sent.push(mail);
    if (!this.#failNext) return Promise.resolve();
    this.#failNext = false;
    return Promise.reject(new Error("the connection closed after the mailer accepted the email"));
  }
}
