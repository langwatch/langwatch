import { createLogger } from "@langwatch/observability";
import type Stripe from "stripe";
import {
  LicenseGenerationService,
  NodeLicenseCryptographyAdapter,
} from "~/runtime/app/licensing";

const logger = createLogger("langwatch:billing:licensePurchaseHandler");

interface HandleLicensePurchaseParams {
  checkoutSession: Stripe.Checkout.Session;
  stripe: Stripe;
  privateKey: string;
}

type LicenseEmailSender = (input: {
  email: string;
  licenseKey: string;
  planType: string;
  maxMembers: number;
  expiresAt: string;
  organizationName: string;
}) => Promise<void>;

type LicensePurchaseNotifier = (input: {
  buyerEmail: string;
  planType: string;
  seats: number;
  amountPaid: number;
  currency: string;
}) => Promise<void>;

export class LicensePurchaseService {
  private constructor(
    private readonly sendLicenseEmail: LicenseEmailSender,
    private readonly notifyLicensePurchase: LicensePurchaseNotifier,
  ) {}

  static create(options: {
    sendLicenseEmail: LicenseEmailSender;
    notifyLicensePurchase: LicensePurchaseNotifier;
  }): LicensePurchaseService {
    return new LicensePurchaseService(
      options.sendLicenseEmail,
      options.notifyLicensePurchase,
    );
  }

  async handle({
    checkoutSession,
    stripe,
    privateKey,
  }: HandleLicensePurchaseParams): Promise<void> {
    const email = checkoutSession.customer_details?.email;
    if (!email) {
      throw new Error("No email found in checkout session customer_details");
    }

    const businessName = checkoutSession.customer_details?.name ?? "";

    // Line items are not included in the webhook payload — must fetch separately.
    const lineItems = await stripe.checkout.sessions.listLineItems(
      checkoutSession.id,
    );
    const quantity = lineItems.data[0]?.quantity ?? 1;

    const { licenseKey, licenseData } = LicenseGenerationService.create(
      NodeLicenseCryptographyAdapter.create(),
    ).generate({
      organizationName: businessName,
      email,
      planType: "GROWTH",
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

    await this.sendLicenseEmail({
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

    // Slack delivery is best-effort inside NotificationService.
    await this.notifyLicensePurchase({
      buyerEmail: email,
      planType: licenseData.plan.type,
      seats: quantity,
      amountPaid: checkoutSession.amount_total ?? 0,
      currency: checkoutSession.currency ?? "usd",
    });
  }
}
