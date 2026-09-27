import type { LicenseEmailDelivery } from "../../services/license-purchase.service.ts";
import { LicenseEmailChannel } from "../license-email.channel.ts";

/** Records the licences it would have mailed, for suites and mail-less deployments. */
export class MemoryLicenseEmailChannel extends LicenseEmailChannel {
  readonly sent: LicenseEmailDelivery[] = [];

  private constructor() {
    super();
  }

  static create(): MemoryLicenseEmailChannel {
    return new MemoryLicenseEmailChannel();
  }

  async send(input: LicenseEmailDelivery): Promise<void> {
    this.sent.push(input);
  }
}
