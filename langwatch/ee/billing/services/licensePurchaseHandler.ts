import type Stripe from "stripe";
import { generateLicenseKey } from "../../licensing/licenseGenerationService";
import { sendLicenseEmail } from "../../../src/server/mailer/licenseEmail";
import { notifyLicensePurchase } from "../notifications/notificationHandlers";
import { createLogger } from "../../../src/utils/logger";

const logger = createLogger("langwatch:billing:licensePurchaseHandler");

interface HandleLicensePurchaseParams {
  checkoutSession: Stripe.Checkout.Session;
  stripe: Stripe;
  privateKey: string;
}

export async function handleLicensePurchase({
  checkoutSession,
  stripe,
  privateKey,
}: HandleLicensePurchaseParams): Promise<void> {
  const email = checkoutSession.customer_details?.email;
  if (!email) {
    throw new Error("No email found in checkout session customer_details");
  }

  const businessName = checkoutSession.customer_details?.name ?? "";

  // Line items are not included in the webhook payload — must fetch separately
  const lineItems = await stripe.checkout.sessions.listLineItems(
    checkoutSession.id,
  );
  const quantity = lineItems.data[0]?.quantity ?? 1;

  const { licenseKey, licenseData } = generateLicenseKey({
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

  await sendLicenseEmail({
    email,
    licenseKey,
    planType: licenseData.plan.type,
    maxMembers: quantity,
    expiresAt: licenseData.expiresAt,
  });

  logger.info(
    { email, licenseId: licenseData.licenseId },
    "[licensePurchaseHandler] License email sent",
  );

  // Slack notification — fire and forget, errors swallowed by notifyLicensePurchase
  await notifyLicensePurchase({
    buyerEmail: email,
    planType: licenseData.plan.type,
    seats: quantity,
    amountPaid: checkoutSession.amount_total ?? 0,
    currency: checkoutSession.currency ?? "usd",
  });
}
