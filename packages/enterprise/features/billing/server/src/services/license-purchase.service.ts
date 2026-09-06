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

/** What a licence unlocks, as `@langwatch/mail`'s `licenseEmailProps.unlockedFeatures` shapes it. */
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
 * Where a licence's tier can send its buyer, resolved from the plan catalogue.
 *
 * A plain structural type rather than an import of `PlanNextStepService`: this
 * package composes the resolver, and does not need the service's own shape to
 * do it.
 */
export type LicenseFeaturesResolver = {
  resolve(input: { planType: string }): Promise<LicenseUnlockedFeatures | undefined>;
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
    private readonly licenseFeatures: LicenseFeaturesResolver | undefined,
  ) {}

  static create(options: {
    delivery: LicensePurchaseDelivery;
    generateLicense: LicenseGenerator;
    /** Resolves what the licence's tier unlocks. Absent skips the hook. */
    licenseFeatures?: LicenseFeaturesResolver;
  }): LicensePurchaseService {
    return new LicensePurchaseService(
      options.delivery,
      options.generateLicense,
      options.licenseFeatures,
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
   * What the issued tier unlocks, or nothing when the deployment composed no
   * catalogue, or the tier could not be resolved. Never guessed: a licence
   * page that drifted from what the licence actually grants is worse than no
   * link at all.
   */
  private async tryResolveUnlockedFeatures(
    planType: string,
  ): Promise<LicenseUnlockedFeatures | undefined> {
    if (!this.licenseFeatures) return undefined;
    try {
      return await this.licenseFeatures.resolve({ planType });
    } catch (error) {
      logger.warn(
        { planType, error },
        "Could not resolve unlocked features for a license email; the mail omits the link",
      );

      return undefined;
    }
  }
}
