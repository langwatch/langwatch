import { createLogger } from "@langwatch/observability";
import {
  Currency,
  type OrganizationUserRole,
  type PrismaClient,
} from "@prisma/client";
import { nanoid } from "nanoid";
import type Stripe from "stripe";
import {
  AmbiguousSubscriptionError,
  NoActiveSubscriptionError,
  QuoteExpiredError,
  SubscriptionItemNotFoundError,
  SubscriptionNotLinkedError,
} from "../errors";
import { SubscriptionStatus } from "../planTypes";
import type { BillingInterval } from "../utils/growthSeatEvent";
import {
  createCheckoutLineItems,
  GROWTH_SEAT_PLAN_TYPES,
  isGrowthSeatPrice,
  resolveGrowthSeatPlanType,
} from "../utils/growthSeatEvent";
import {
  requireCheckoutCurrency,
  resolveCheckoutCurrency,
} from "../utils/stripeCustomerCurrency";

const logger = createLogger("langwatch:billing:seatEventSubscription");

type InviteInput = {
  email: string;
  role: OrganizationUserRole;
  teamIds: string;
};

export type SeatEventSubscriptionFns = ReturnType<
  typeof createSeatEventSubscriptionFns
>;

/**
 * The two money figures a seat quote reports, read off a previewed invoice.
 *
 * For an `always_invoice` preview the invoice IS the immediate one: it carries
 * only the proration lines, not next cycle's recurring and metered usage.
 *
 * **`total`, never a sum over `lines.data`.** Line amounts are pre-tax, so a
 * customer billed in a tax-exclusive currency was quoted a fifth under what
 * their card is debited; and `lines` is a paginated sublist, so a subscription
 * carrying enough pending prorations silently drops the ones past page one.
 *
 * **The charge is `amount_due`, not `total`.** `amount_due` is the total after
 * any credit the account already holds is spent against it, and it is the
 * figure the charge is raised for. Measured on one purchase, two accounts:
 *
 *     clean      total 293.70   amount_due 293.70   charged 293.70
 *     credited   total 293.70   amount_due  93.70   charged  93.70
 *
 * Quoting the total there tells a customer with a balance they are about to
 * pay 293.70 while their card takes 93.70. Both are true; only one of them is
 * what "Due today" means.
 *
 * **But `amount_due` is not simply the better field.** It clamps a negative
 * invoice to zero, so a seat REDUCTION previewing a total of -587.39 reports 0
 * and the dialog would say nothing happens over a 587.39 credit. Hence the
 * branch: a credit is described by the signed total, a charge by the amount
 * actually due.
 */
const quotedAmounts = (preview: Stripe.Invoice) => {
  const invoiceTotalCents = preview.total;
  const isCredit = invoiceTotalCents < 0;

  return {
    prorationCents: isCredit ? invoiceTotalCents : preview.amount_due,
    // Credit spent on this invoice, so the dialog can explain a "Due today"
    // smaller than the change itself. Zero on a clean account, and never
    // reported for a credit — nothing is drawn down by one.
    creditAppliedCents: isCredit ? 0 : invoiceTotalCents - preview.amount_due,
  };
};

/**
 * The seat change itself — read by BOTH the preview and the update, so the
 * quote cannot describe a different operation from the one performed.
 *
 * They diverged before: the update reverses a scheduled cancellation (the
 * customer buying a seat is choosing to keep the plan), while the preview
 * modelled the subscription as still cancelling. On an annual plan billed
 * alongside a monthly meter, cancellation truncates the seat line to the
 * monthly boundary, so the same 6→8 seat change quoted €54.25 and charged
 * €639.91. `always_invoice` matters for the same reason: it bills every
 * pending proration immediately, including any the subscription already
 * carried, so the preview must count those rather than net them out.
 */
const seatChangeParams = ({
  stripeSubscription,
  seatItem,
  quantity,
  prorationDate,
}: {
  stripeSubscription: Stripe.Subscription;
  seatItem: Stripe.SubscriptionItem;
  quantity: number;
  prorationDate: number;
}) => ({
  ...(stripeSubscription.canceled_at ? { cancel_at_period_end: false } : {}),
  items: [{ id: seatItem.id, quantity }],
  proration_behavior: "always_invoice" as const,
  // Prorations are priced by the moment they are applied, so a quote issued
  // at one instant and confirmed at another are two different amounts. The
  // quote issues this timestamp and the confirmation sends it back, which
  // makes the charge reproduce the number the customer read rather than
  // merely resemble it.
  proration_date: prorationDate,
});

/**
 * How long a quote may be confirmed against the instant it priced.
 *
 * Long enough to read a dialog and decide; short enough that the pinned
 * instant is still a fair description of "now". Past this the confirmation
 * is refused and the customer gets a fresh quote — see {@link QuoteExpiredError}.
 */
const QUOTE_VALIDITY_SECONDS = 15 * 60;

/**
 * The instant to price a seat change at.
 *
 * With no quote to honour (the background seat sync, which nobody is
 * watching a number for) this is simply now. With one, it is the instant the
 * quote priced — unless that is stale or in the future, which no quote we
 * issued can be.
 */
const resolveProrationDate = (quotedAt: number | undefined) => {
  const now = Math.floor(Date.now() / 1000);
  if (quotedAt === undefined) return now;

  const age = now - quotedAt;
  if (age < 0 || age > QUOTE_VALIDITY_SECONDS) {
    throw new QuoteExpiredError();
  }
  return quotedAt;
};

export const createSeatEventSubscriptionFns = ({
  stripe,
  db,
}: {
  stripe: Stripe;
  db: PrismaClient;
}) => {
  /**
   * The subscription a seat change should act on, or a named reason there
   * isn't one.
   *
   * Reads the candidates once and ranks them, rather than querying for a
   * linked row first: `cancel()` keeps `stripeSubscriptionId` on a CANCELLED
   * row deliberately, so a churned subscription is a permanent tombstone. A
   * "most recent row that has an id" lookup therefore returns that tombstone
   * forever — beating a live ACTIVE row that happens to be older, and hiding
   * an ACTIVE-but-never-linked row behind `subscription_sync_failed`, whose
   * copy promises the customer it catches up on its own. It never does.
   */
  const findSeatSubscription = async (organizationId: string) => {
    const candidates = await db.subscription.findMany({
      where: {
        organizationId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const linked = (subscription: (typeof candidates)[number]) =>
      subscription.stripeSubscriptionId !== null;

    const active = candidates.filter(
      (s) => s.status === SubscriptionStatus.ACTIVE,
    );

    // Two live plans on one account: refuse, do not choose. There is no unique
    // index on `organizationId`, and the backoffice form writes ACTIVE rows
    // with no uniqueness check, so this state is reachable and the row that
    // still carries a provider id is not reliably the one the operator meant
    // to keep. Charging either is a coin flip against a customer's card.
    if (active.length > 1) {
      logger.error(
        {
          organizationId,
          subscriptionIds: active.map((s) => s.id),
          linkedCount: active.filter(linked).length,
        },
        "[billing] Organization has multiple active subscriptions; refusing to guess which one a seat change belongs to",
      );
      throw new AmbiguousSubscriptionError(active.length);
    }

    // A live subscription we can act on beats everything.
    const activeLinked = candidates.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && linked(s),
    );
    if (activeLinked?.stripeSubscriptionId) {
      return {
        ...activeLinked,
        stripeSubscriptionId: activeLinked.stripeSubscriptionId,
      };
    }

    // An ACTIVE row with no link outranks any cancelled one: it is the
    // organization's current plan, and it is the state only an operator can
    // clear (nothing but the checkout webhook ever writes the link).
    const activeUnlinked = candidates.find(
      (s) => s.status === SubscriptionStatus.ACTIVE && !linked(s),
    );
    if (activeUnlinked) {
      logger.error(
        { organizationId, subscriptionId: activeUnlinked.id },
        "[billing] Active subscription has no billing-provider link; seat changes need one to be connected by hand",
      );
      throw new SubscriptionNotLinkedError();
    }

    // Cancelled in our records but possibly still live at the provider —
    // updating seats is how a customer reverses a scheduled cancellation.
    const cancelledLinked = candidates.find((s) => linked(s));
    if (cancelledLinked?.stripeSubscriptionId) {
      return {
        ...cancelledLinked,
        stripeSubscriptionId: cancelledLinked.stripeSubscriptionId,
      };
    }

    throw new NoActiveSubscriptionError();
  };

  /** The subscription, its provider record, and the seat line to change. */
  const loadSeatChangeTarget = async (organizationId: string) => {
    const subscription = await findSeatSubscription(organizationId);

    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId,
    );

    // Must still be live at the provider, even if scheduled for cancellation.
    if (stripeSubscription.status !== "active") {
      throw new NoActiveSubscriptionError();
    }

    const seatItem = stripeSubscription.items.data.find((item) =>
      isGrowthSeatPrice(item.price.id),
    );

    if (!seatItem) {
      throw new SubscriptionItemNotFoundError("seat");
    }

    return { subscription, stripeSubscription, seatItem };
  };

  return {
    async createSeatEventCheckout({
      organizationId,
      customerId,
      baseUrl,
      currency,
      billingInterval,
      membersToAdd,
      isUpgradeFromTiered = false,
      invites,
    }: {
      organizationId: string;
      customerId: string;
      baseUrl: string;
      currency: Currency;
      billingInterval: BillingInterval;
      membersToAdd: number;
      isUpgradeFromTiered?: boolean;
      invites?: InviteInput[];
    }) {
      // Resolve the currency before touching the database. A checkout we cannot
      // build in the customer's own currency will be rejected outright, and every
      // write below this point would have to be cleaned up afterwards.
      const checkoutCurrency = requireCheckoutCurrency(
        await resolveCheckoutCurrency({
          stripe,
          customerId,
          organizationId,
          requestedCurrency: currency,
        }),
      );

      // Find stale PENDING subs so we can clean up their PAYMENT_PENDING invites too
      const staleSubs = await db.subscription.findMany({
        where: {
          organizationId,
          plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
          status: SubscriptionStatus.PENDING,
        },
        select: { id: true },
      });

      const staleSubIds = staleSubs.map((s) => s.id);

      // Cancel stale PENDING subs from abandoned checkouts
      await db.subscription.updateMany({
        where: {
          organizationId,
          plan: { in: [...GROWTH_SEAT_PLAN_TYPES] },
          status: SubscriptionStatus.PENDING,
        },
        data: {
          status: SubscriptionStatus.CANCELLED,
          endDate: new Date(),
        },
      });

      // Clean up orphaned PAYMENT_PENDING invites from stale subs
      if (staleSubIds.length > 0) {
        await db.organizationInvite.deleteMany({
          where: {
            organizationId,
            status: "PAYMENT_PENDING",
            subscriptionId: { in: staleSubIds },
          },
        });
      }

      // Build line items BEFORE persisting anything so a validation failure
      // doesn't leave orphaned pending records in the database.
      const lineItems = createCheckoutLineItems({
        coreMembers: membersToAdd,
        currency: checkoutCurrency,
        interval: billingInterval,
      });

      // Create subscription + invites in a transaction
      const subscription = await db.$transaction(async (tx) => {
        const sub = await tx.subscription.create({
          data: {
            organizationId,
            status: SubscriptionStatus.PENDING,
            plan: resolveGrowthSeatPlanType({
              currency: checkoutCurrency,
              interval: billingInterval,
            }),
            maxMembers: membersToAdd,
          },
        });

        if (invites && invites.length > 0) {
          for (const invite of invites) {
            // Skip duplicates (existing PENDING or PAYMENT_PENDING invites)
            const existing = await tx.organizationInvite.findFirst({
              where: {
                email: invite.email,
                organizationId,
                status: { in: ["PENDING", "PAYMENT_PENDING"] },
                OR: [{ expiration: { gt: new Date() } }, { expiration: null }],
              },
            });

            if (existing) continue;

            await tx.organizationInvite.create({
              data: {
                email: invite.email,
                inviteCode: nanoid(),
                expiration: null,
                organizationId,
                teamIds: invite.teamIds,
                role: invite.role,
                status: "PAYMENT_PENDING",
                subscriptionId: sub.id,
              },
            });
          }
        }

        return sub;
      });

      const selectedOptionsMetadata = {
        selectedCurrency: checkoutCurrency,
        selectedBillingInterval: billingInterval,
      };

      // Anchor billing cycle to the 1st of next month for all plans.
      // Customer pays prorated amount for the partial period (checkout → anchor),
      // then full price (monthly or annual) starting on the 1st.
      const now = new Date();
      const billingCycleAnchor = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
      );
      const subscriptionData: Stripe.Checkout.SessionCreateParams["subscription_data"] =
        {
          metadata: selectedOptionsMetadata,
          billing_cycle_anchor: Math.floor(billingCycleAnchor.getTime() / 1000),
          proration_behavior:
            "create_prorations" as Stripe.Checkout.SessionCreateParams.SubscriptionData.ProrationBehavior,
        };

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        currency: checkoutCurrency.toLowerCase(),
        ...({ adaptive_pricing: { enabled: false } } as Record<
          string,
          unknown
        >),
        customer: customerId,
        customer_update: {
          address: "auto",
          name: "auto",
        },
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        tax_id_collection: { enabled: true },
        line_items: lineItems,
        metadata: selectedOptionsMetadata,
        subscription_data: subscriptionData,
        success_url: `${baseUrl}/settings/subscription?success${isUpgradeFromTiered ? "&upgraded_from=tiered" : ""}`,
        cancel_url: `${baseUrl}/settings/subscription`,
        client_reference_id: `subscription_setup_${subscription.id}`,
        allow_promotion_codes: true,
      });

      return { url: session.url };
    },

    async updateSeatEventItems({
      organizationId,
      totalMembers,
      quotedAt,
    }: {
      organizationId: string;
      totalMembers: number;
      /**
       * The instant a quote for this change was priced, from
       * {@link previewProration}. Omitted by callers acting without a quote on
       * screen, which are then priced at the moment they run.
       */
      quotedAt?: number;
    }) {
      // Every failure below throws rather than returning `{ success: false }`:
      // a silent false used to resolve the mutation as a success, so the UI
      // toasted "Seats updated successfully" over a seat count that never moved.

      // First, so an expired quote is refused before the provider is touched.
      const prorationDate = resolveProrationDate(quotedAt);

      const { subscription, stripeSubscription, seatItem } =
        await loadSeatChangeTarget(organizationId);

      // Charges the proration immediately, and reactivates the subscription if
      // it was scheduled for cancellation — the customer buying a seat is
      // choosing to keep it.
      await stripe.subscriptions.update(
        subscription.stripeSubscriptionId,
        seatChangeParams({
          stripeSubscription,
          seatItem,
          quantity: totalMembers,
          prorationDate,
        }),
      );

      // Restore DB record to ACTIVE with updated seat count
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: SubscriptionStatus.ACTIVE,
          maxMembers: totalMembers,
          endDate: null,
        },
      });

      return { success: true };
    },

    async previewProration({
      organizationId,
      newTotalSeats,
    }: {
      organizationId: string;
      newTotalSeats: number;
    }) {
      const prorationDate = resolveProrationDate(undefined);

      const { subscription, stripeSubscription, seatItem } =
        await loadSeatChangeTarget(organizationId);

      // Preview the exact change the confirm button performs. This goes through
      // the Create Preview Invoice API, not the Upcoming Invoice API: Stripe
      // rejects `retrieveUpcoming` for subscriptions on flexible billing mode on
      // every API version, and subscriptions migrated to flexible billing are
      // live customer state.
      const preview = await stripe.invoices.createPreview({
        subscription: subscription.stripeSubscriptionId,
        subscription_details: seatChangeParams({
          stripeSubscription,
          seatItem,
          quantity: newTotalSeats,
          prorationDate,
        }),
      });

      const currency = (preview.currency?.toUpperCase() ??
        Currency.USD) as Currency;
      const billingInterval = seatItem.price.recurring?.interval ?? "month";

      const { prorationCents, creditAppliedCents } = quotedAmounts(preview);

      // Recurring total: new seat count × per-seat price.
      //
      // No `?? 0` fallback. Stripe reports `unit_amount: null` for tiered and
      // metered prices, and a seat line without a per-seat figure has no
      // recurring total to quote — defaulting to zero would print "€0 per year"
      // beside a button that charges the card, which is the same class of lie
      // this whole change exists to remove. Today the seat line is always one
      // of four flat licensed prices, so this is unreachable; it becomes
      // reachable the moment someone adds a tiered seat price to the catalog,
      // and it should fail loudly then rather than misprice the purchase.
      const unitAmountCents = seatItem.price.unit_amount;
      if (unitAmountCents === null) {
        throw new SubscriptionItemNotFoundError("seat_unit_amount");
      }
      const recurringTotalCents = newTotalSeats * unitAmountCents;

      const format = (cents: number) => {
        const amount = cents / 100;
        return new Intl.NumberFormat(
          currency === Currency.EUR ? "en-IE" : "en-US",
          {
            style: "currency",
            currency,
            minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
            maximumFractionDigits: 2,
          },
        ).format(amount);
      };

      return {
        // Signed, so the dialog can tell a charge from a credit: removing
        // seats previews a negative amount.
        amountDueCents: prorationCents,
        formattedAmountDue: format(prorationCents),
        // Null rather than a formatted zero: the dialog should say nothing at
        // all about credit on an account that has none.
        formattedCreditApplied:
          creditAppliedCents > 0 ? format(creditAppliedCents) : null,
        formattedRecurringTotal: format(recurringTotalCents),
        billingInterval,
        // The instant this quote priced. Sent back on confirm so the charge is
        // computed against the same moment the customer was shown.
        quotedAt: prorationDate,
      };
    },

    async seatEventBillingPortalUrl({
      customerId,
      baseUrl,
    }: {
      customerId: string;
      baseUrl: string;
    }) {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/settings/subscription`,
      });

      return { url: session.url };
    },
  };
};
