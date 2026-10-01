import {
  sendSsoDomainProofLapsedEmail,
  sendSsoDomainProofWaveringEmail,
  type MailSender,
} from "@langwatch/mail";
import { Temporal } from "@langwatch/time";

import type { SsoDomainProofMail } from "../../app/identity.members.ts";
import { SsoDomainProofMailChannel } from "../sso-domain-proof-mail.channel.ts";

type Input<Name extends keyof SsoDomainProofMail> = Parameters<SsoDomainProofMail[Name]>[0];

/** Main's domain-proof mails over the process's mail member; mail off skips each with one line. */
export class SesSsoDomainProofMailChannel extends SsoDomainProofMailChannel {
  static create(input: { mailer: MailSender; baseUrl: string }): SesSsoDomainProofMailChannel {
    return new SesSsoDomainProofMailChannel(input.mailer, input.baseUrl);
  }

  private constructor(
    private readonly mailer: MailSender,
    private readonly baseUrl: string,
  ) {
    super();
  }

  private accessSettingsUrl(): string {
    return `${this.baseUrl}/settings/access`;
  }

  sendProofWavering({
    record,
    graceEndsAtMs,
    ...input
  }: Input<"sendProofWavering">): Promise<void> {
    return sendSsoDomainProofWaveringEmail({
      ...input,
      ...record,
      graceEndsAt: Temporal.Instant.fromEpochMilliseconds(graceEndsAtMs).toString(),
      accessSettingsUrl: this.accessSettingsUrl(),
      mailer: this.mailer,
    });
  }

  sendProofLapsed({ record, ...input }: Input<"sendProofLapsed">): Promise<void> {
    return sendSsoDomainProofLapsedEmail({
      ...input,
      ...record,
      accessSettingsUrl: this.accessSettingsUrl(),
      mailer: this.mailer,
    });
  }
}
