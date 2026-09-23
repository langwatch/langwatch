import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";

import {
  NullBillingErrorReporter,
  type BillingErrorReporter,
} from "./billing-error-reporter.service.ts";

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

/** What a licence unlocks; shaped for licenseEmailProps.unlockedFeatures. */
export type LicenseUnlockedFeatures =
  | { kind: "self_serve"; url: string }
  | { kind: "account_team"; contactUrl: string };

export type LicenseEmailDelivery = {
  email: string;
  licenseKey: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
  organizationName: string;
  /**
   * What this licence unlocks, resolved for the tier it was issued on. Absent
   * when the deployment composed no catalogue to resolve it from — the mail
   * still sends, without the link.
   */
  unlockedFeatures?: LicenseUnlockedFeatures;
};

/**
 * Where a licence's tier can send its buyer, resolved from the plan
 * catalogue. A plain structural type, not an import of
 * `PlanNextStepService` — this package composes the resolver.
 */
export type LicenseFeaturesResolver = {
  find(input: { planType: string }): Promise<LicenseUnlockedFeatures | undefined>;
};

export type LicensePurchaseNotification = {
  buyerEmail: string;
  planType: string;
  seats: number;
  amountPaid: number;
  currency: string;
};

export abstract class LicensePurchaseDelivery {
  /** Writes the minted license to the license registry (ADR-156), source PURCHASE. */
  abstract recordLicense(input: { licenseKey: string }): Promise<void>;

  abstract sendLicenseEmail(input: LicenseEmailDelivery): Promise<void>;

  abstract notifyLicensePurchase(input: LicensePurchaseNotification): Promise<void>;
}

/** The fields of a completed Stripe Checkout session the purchase reads. */
export type PurchasedCheckout = Pick<
  Stripe.Checkout.Session,
  "id" | "amount_total" | "currency"
> & { customer_details: { email: string | null; name: string | null } | null };

/** The one Stripe read the purchase makes: the seats bought. */
export type CheckoutLineItems = {
  checkout: {
    sessions: {
      listLineItems(id: string): Promise<{ data: readonly { quantity: number | null }[] }>;
    };
  };
};

/** Generates and delivers a license purchased through Stripe Checkout. */
export class LicensePurchaseService {
  private readonly delivery: LicensePurchaseDelivery;
  private readonly generateLicense: LicenseGenerator;
  private readonly licenseFeatures: LicenseFeaturesResolver | undefined;
  private readonly errorReporter: BillingErrorReporter;

  private constructor({
    delivery,
    generateLicense,
    licenseFeatures,
    errorReporter,
  }: {
    delivery: LicensePurchaseDelivery;
    generateLicense: LicenseGenerator;
    licenseFeatures: LicenseFeaturesResolver | undefined;
    errorReporter: BillingErrorReporter;
  }) {
    this.delivery = delivery;
    this.generateLicense = generateLicense;
    this.licenseFeatures = licenseFeatures;
    this.errorReporter = errorReporter;
  }

  static create(options: {
    delivery: LicensePurchaseDelivery;
    generateLicense: LicenseGenerator;
    /** Resolves what the licence's tier unlocks. Absent skips the hook. */
    licenseFeatures?: LicenseFeaturesResolver;
    errorReporter?: BillingErrorReporter;
  }): LicensePurchaseService {
    return new LicensePurchaseService({
      delivery: options.delivery,
      generateLicense: options.generateLicense,
      licenseFeatures: options.licenseFeatures,
      errorReporter: options.errorReporter ?? NullBillingErrorReporter.create(),
    });
  }

  async handle({
    checkoutSession,
    stripe,
    privateKey,
  }: {
    checkoutSession: PurchasedCheckout;
    stripe: CheckoutLineItems;
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
    // The buyer has paid: a registry that cannot be written must not stand
    // between them and their license. Reported, and the email still goes out.
    try {
      await this.delivery.recordLicense({ licenseKey });
    } catch (error) {
      logger.error(
        { licenseId: licenseData.licenseId, error },
        "[licensePurchaseHandler] License could not be recorded in the registry",
      );
      this.errorReporter.capture(error instanceof Error ? error : new Error(String(error)));
    }

    const unlockedFeatures = await this.tryResolveUnlockedFeatures(licenseData.plan.type);
    await this.delivery.sendLicenseEmail({
      email,
      licenseKey,
      planType: licenseData.plan.type,
      maxMembers: quantity,
      expiresAt: licenseData.expiresAt,
      organizationName: licenseData.organizationName,
      ...(unlockedFeatures ? { unlockedFeatures } : {}),
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

  /**
   * What the issued tier unlocks, or nothing when there is no catalogue or
   * the tier can't resolve. Never guessed: a licence page drifting from
   * what it actually grants is worse than no link at all.
   */
  private async tryResolveUnlockedFeatures(
    planType: string,
  ): Promise<LicenseUnlockedFeatures | undefined> {
    if (!this.licenseFeatures) return undefined;
    try {
      return await this.licenseFeatures.find({ planType });
    } catch (error) {
      logger.warn(
        { planType, error },
        "Could not resolve unlocked features for a license email; the mail omits the link",
      );

      return undefined;
    }
  }
}
