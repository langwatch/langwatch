import type { LicensePurchaseNotificationPayload } from "@langwatch/enterprise-billing-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";

import type { LicenseEmailChannel } from "../channels/license-email.channel.ts";
import {
  type LicenseEmailDelivery,
  LicensePurchaseDelivery,
  type LicensePurchaseNotification,
} from "./license-purchase.service.ts";

/**
 * Where a purchased licence goes, as main sent it: the licence registry (source
 * PURCHASE, unlinked), the buyer's inbox, and the subscriptions Slack channel.
 */
export class LicensePurchaseDeliveryService extends LicensePurchaseDelivery {
  private constructor(
    private readonly licensing: Pick<LicensingApi, "recordIssuedLicense">,
    private readonly mail: LicenseEmailChannel,
    private readonly notices: {
      sendSlackLicensePurchase(payload: LicensePurchaseNotificationPayload): Promise<void>;
    },
  ) {
    super();
  }

  static create(options: {
    licensing: Pick<LicensingApi, "recordIssuedLicense">;
    mail: LicenseEmailChannel;
    notices: {
      sendSlackLicensePurchase(payload: LicensePurchaseNotificationPayload): Promise<void>;
    };
  }): LicensePurchaseDeliveryService {
    return new LicensePurchaseDeliveryService(options.licensing, options.mail, options.notices);
  }

  async recordLicense({ licenseKey }: { licenseKey: string }): Promise<void> {
    await this.licensing.recordIssuedLicense({ licenseKey, source: "PURCHASE" });
  }

  sendLicenseEmail(input: LicenseEmailDelivery): Promise<void> {
    return this.mail.send(input);
  }

  notifyLicensePurchase(input: LicensePurchaseNotification): Promise<void> {
    return this.notices.sendSlackLicensePurchase(input);
  }
}
