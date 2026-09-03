// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  BillingPriceCatalogue,
  getStripeEnvironmentFromNodeEnv,
} from "@langwatch/enterprise-billing-contract";
import Stripe from "stripe";
import {
  StripeUsageReportingService,
  type UsageReportingService,
} from "../services/usage-reporting.service";

/**
 * The Stripe SDK policy one composed process holds.
 *
 * Frozen twin: `AppStripeRuntime` (`platform/app/src/runtime/app/stripe.runtime.ts`)
 * builds its client with these exact four settings from the same
 * `STRIPE_SECRET_KEY`. The API version is the one both graphs report meter
 * events against, so it may not drift on one side: a client pinned to a
 * different version can be told about a meter event shape the other never
 * sends.
 */
const STRIPE_API_VERSION = "2024-04-10" as const;
const STRIPE_MAX_NETWORK_RETRIES = 1;
const STRIPE_TELEMETRY = true;

/** A SaaS process that cannot reach Stripe has no usage to report through. */
export class StripeUsageReportingUnavailable extends Error {
  readonly name = "StripeUsageReportingUnavailable";

  constructor() {
    super("A Stripe secret key is required for SaaS billing runtime");
  }
}

/**
 * Constructs the meter-event sender the monthly roll-up reports through.
 *
 * The meter id comes from the checked-in price catalogue, keyed by the same
 * environment reading the App uses — `production` is Stripe's live mode and
 * everything else is test — so the two graphs cannot report into two different
 * meters for one deployment.
 *
 * Refusing without a key rather than degrading is deliberate, and it is the
 * refusal the App already makes: a SaaS process whose reporting service is
 * absent counts every billable event correctly and reports none of them, which
 * is revenue present in ClickHouse, absent from Stripe, and visible nowhere
 * else. A self-hosted process composes no sender at all and never asks.
 */
export class StripeUsageReportingAdapter {
  static create(options: {
    secretKey: string | undefined;
    nodeEnvironment: string | undefined;
  }): StripeUsageReportingAdapter {
    return new StripeUsageReportingAdapter(options.secretKey, options.nodeEnvironment);
  }

  private constructor(
    private readonly secretKey: string | undefined,
    private readonly nodeEnvironment: string | undefined,
  ) {}

  build(): UsageReportingService {
    if (!this.secretKey) throw new StripeUsageReportingUnavailable();

    return StripeUsageReportingService.create({
      stripe: new Stripe(this.secretKey, {
        apiVersion: STRIPE_API_VERSION,
        maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES,
        telemetry: STRIPE_TELEMETRY,
      }),
      meterId: BillingPriceCatalogue.create(getStripeEnvironmentFromNodeEnv(this.nodeEnvironment))
        .meters.BILLABLE_EVENTS,
    });
  }
}
