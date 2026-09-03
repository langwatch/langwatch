import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";

const logger = createLogger("langwatch:billing:licensePurchaseHandler");

export type GeneratedLicense = {
  licenseKey: string;
  licenseData: {
    licenseId: string;
    plan: { type: string };
    expiresAt: string;
    organizationName: string;
  };
};

export abstract class LicenseGenerator {
  abstract generate(input: {
    organizationName: string;
    email: string;
    maxMembers: number;
    privateKey: string;
  }): GeneratedLicense;
}

export type LicenseEmailDelivery = {
  email: string;
  licenseKey: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
  organizationName: string;
};

export type LicensePurchaseNotification = {
  buyerEmail: string;
  planType: string;
  seats: number;
  amountPaid: number;
  currency: string;
};

export abstract class LicensePurchaseDelivery {
  abstract sendLicenseEmail(input: LicenseEmailDelivery): Promise<void>;

  abstract notifyLicensePurchase(input: LicensePurchaseNotification): Promise<void>;
}

/** Generates and delivers a license purchased through Stripe Checkout. */
export class LicensePurchaseService {
  private constructor(
    private readonly delivery: LicensePurchaseDelivery,
    private readonly generateLicense: LicenseGenerator,
  ) {}

  static create(options: {
    delivery: LicensePurchaseDelivery;
    generateLicense: LicenseGenerator;
  }): LicensePurchaseService {
    return new LicensePurchaseService(
      options.delivery,
      options.generateLicense,
    );
  }

  async handle({
    checkoutSession,
    stripe,
    privateKey,
  }: {
    checkoutSession: Stripe.Checkout.Session;
    stripe: Stripe;
    privateKey: string;
  }): Promise<void> {
    const email = checkoutSession.customer_details?.email;
    if (!email) {
      throw new Error("No email found in checkout session customer_details");
    }
    const businessName = checkoutSession.customer_details?.name ?? "";
    const lineItems = await stripe.checkout.sessions.listLineItems(checkoutSession.id);
    const quantity = lineItems.data[0]?.quantity ?? 1;
    const { licenseKey, licenseData } = this.generateLicense.generate({
      organizationName: businessName,
      email,
      maxMembers: quantity,
      privateKey,
    });

    logger.info(
      {
        licenseId: licenseData.licenseId,
        email,
        seats: quantity,
        expiresAt: licenseData.expiresAt,
      },
      "[licensePurchaseHandler] License generated",
    );
    await this.delivery.sendLicenseEmail({
      email,
      licenseKey,
      planType: licenseData.plan.type,
      maxMembers: quantity,
      expiresAt: licenseData.expiresAt,
      organizationName: licenseData.organizationName,
    });
    logger.info(
      { email, licenseId: licenseData.licenseId },
      "[licensePurchaseHandler] License email sent",
    );
    await this.delivery.notifyLicensePurchase({
      buyerEmail: email,
      planType: licenseData.plan.type,
      seats: quantity,
      amountPaid: checkoutSession.amount_total ?? 0,
      currency: checkoutSession.currency ?? "usd",
    });
  }
}
