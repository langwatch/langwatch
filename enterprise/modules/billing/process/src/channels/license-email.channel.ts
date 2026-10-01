import type { LicenseEmailDelivery } from "../services/license-purchase.service.ts";

/** The purchased licence, mailed to its buyer with the key attached. */
export abstract class LicenseEmailChannel {
  abstract send(input: LicenseEmailDelivery): Promise<void>;
}
