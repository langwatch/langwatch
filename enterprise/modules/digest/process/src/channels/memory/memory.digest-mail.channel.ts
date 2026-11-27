// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { DigestMailChannel, type RenderedDigestMail } from "../digest-mail.channel.ts";

/** Records every email exactly as handed over, repeats included, so a double send shows. */
export class MemoryDigestMailChannel extends DigestMailChannel {
  static create(): MemoryDigestMailChannel {
    return new MemoryDigestMailChannel();
  }

  readonly sent: RenderedDigestMail[] = [];

  private constructor() {
    super();
  }

  async send(mail: RenderedDigestMail): Promise<void> {
    this.sent.push(mail);
  }
}
