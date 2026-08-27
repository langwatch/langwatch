import {
  LicenseGenerationService,
  NodeLicenseCryptographyAdapter,
} from "~/runtime/app/licensing";
import {
  LicenseGenerator,
  LicensePurchaseDelivery,
  LicensePurchaseService as PackagedLicensePurchaseService,
  type LicenseEmailDelivery,
  type LicensePurchaseNotification,
} from "@langwatch/enterprise-billing-server";

class AppLicenseGenerator extends LicenseGenerator {
  generate(input: {
    organizationName: string;
    email: string;
    maxMembers: number;
    privateKey: string;
  }) {
    return LicenseGenerationService.create(
      NodeLicenseCryptographyAdapter.create(),
    ).generate({
      organizationName: input.organizationName,
      email: input.email,
      planType: "GROWTH",
      maxMembers: input.maxMembers,
      privateKey: input.privateKey,
    });
  }
}

class AppLicensePurchaseDelivery extends LicensePurchaseDelivery {
  constructor(
    private readonly sendEmail: (input: LicenseEmailDelivery) => Promise<void>,
    private readonly sendNotification: (
      input: LicensePurchaseNotification,
    ) => Promise<void>,
  ) {
    super();
  }

  override sendLicenseEmail(input: LicenseEmailDelivery): Promise<void> {
    return this.sendEmail(input);
  }

  override notifyLicensePurchase(input: LicensePurchaseNotification): Promise<void> {
    return this.sendNotification(input);
  }
}

/** App-only license cryptography wiring; the purchase workflow is packaged. */
export const createLicensePurchaseService = (options: {
  sendLicenseEmail: (input: LicenseEmailDelivery) => Promise<void>;
  notifyLicensePurchase: (input: LicensePurchaseNotification) => Promise<void>;
}): PackagedLicensePurchaseService =>
  PackagedLicensePurchaseService.create({
    delivery: new AppLicensePurchaseDelivery(
      options.sendLicenseEmail,
      options.notifyLicensePurchase,
    ),
    generateLicense: new AppLicenseGenerator(),
  });
