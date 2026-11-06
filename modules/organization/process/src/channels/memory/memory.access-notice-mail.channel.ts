import type { AccessNoticeDigestProps, SeatRequestProps } from "@langwatch/mail";

import { AccessNoticeMailChannel, type IdpRefusedMail } from "../access-notice-mail.channel.ts";

type Envelope = Readonly<{ idempotencyKey: string }>;

/** Records each access notice mail it is handed and sends nothing. */
export class MemoryAccessNoticeMailChannel extends AccessNoticeMailChannel {
  static create(): MemoryAccessNoticeMailChannel {
    return new MemoryAccessNoticeMailChannel();
  }

  readonly seatRequests: (SeatRequestProps & Envelope)[] = [];
  readonly idpRefusals: (IdpRefusedMail & Envelope)[] = [];
  readonly digests: (AccessNoticeDigestProps & Envelope)[] = [];

  private constructor() {
    super();
  }

  async sendSeatRequest(input: SeatRequestProps & Envelope): Promise<void> {
    this.seatRequests.push(input);
  }

  async sendIdpRefused(input: IdpRefusedMail & Envelope): Promise<void> {
    this.idpRefusals.push(input);
  }

  async sendDigest(input: AccessNoticeDigestProps & Envelope): Promise<void> {
    this.digests.push(input);
  }
}
