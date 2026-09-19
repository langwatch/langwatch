/**
 * Billing credit grants (ADR-139, section 7).
 *
 * The prepaid commit of a connected customer is a paid credit grant that
 * applies to metered usage only, so a seat invoice can never draw it down.
 * The pinned Stripe SDK has no `billing.creditGrants` resource, so the four
 * calls we need are declared here against the API version that serves them.
 * Everything else in the app keeps the SDK's own version.
 */

import Stripe from "stripe";

/** The API version that serves `/v1/billing/credit_grants`. */
const CREDIT_GRANTS_API_VERSION = "2025-02-24.acacia";

export type CreditGrantCategory = "paid" | "promotional";

export interface CreditGrant {
  id: string;
  object: string;
  customer: string;
  name: string | null;
  category: CreditGrantCategory;
  amount: {
    type: string;
    monetary: { currency: string; value: number } | null;
  };
  applicability_config: {
    scope: { price_type?: string; prices?: { id: string }[] };
  };
  effective_at: number | null;
  expires_at: number | null;
  voided_at: number | null;
  livemode: boolean;
  metadata: Record<string, string>;
}

export interface CreateCreditGrantParams {
  customer: string;
  name: string;
  category: CreditGrantCategory;
  amount: { type: "monetary"; monetary: { currency: string; value: number } };
  applicability_config: { scope: { price_type: "metered" } };
  /** Unix seconds. Left out for a grant that never expires. */
  expires_at?: number;
  metadata?: Record<string, string>;
}

export interface ListCreditGrantsParams {
  customer: string;
  limit?: number;
}

export interface CreditGrantList {
  object: string;
  data: CreditGrant[];
  has_more: boolean;
}

/** The four calls the connected billing ledger makes. */
export interface CreditGrants {
  create(
    params: CreateCreditGrantParams,
    options?: { idempotencyKey?: string },
  ): Promise<CreditGrant>;
  retrieve(id: string): Promise<CreditGrant>;
  list(params: ListCreditGrantsParams): Promise<CreditGrantList>;
  void(id: string): Promise<CreditGrant>;
}

type RawCreditGrantsResource = {
  create(
    params: CreateCreditGrantParams,
    options: Stripe.RequestOptions,
  ): Promise<CreditGrant>;
  retrieve(
    id: string,
    params: Record<string, never>,
    options: Stripe.RequestOptions,
  ): Promise<CreditGrant>;
  list(
    params: ListCreditGrantsParams,
    options: Stripe.RequestOptions,
  ): Promise<CreditGrantList>;
  void(
    id: string,
    params: Record<string, never>,
    options: Stripe.RequestOptions,
  ): Promise<CreditGrant>;
};

const CreditGrantsResource = Stripe.StripeResource.extend({
  create: Stripe.StripeResource.method({
    method: "POST",
    fullPath: "/v1/billing/credit_grants",
  }),
  retrieve: Stripe.StripeResource.method({
    method: "GET",
    fullPath: "/v1/billing/credit_grants/{id}",
  }),
  list: Stripe.StripeResource.method({
    method: "GET",
    fullPath: "/v1/billing/credit_grants",
  }),
  void: Stripe.StripeResource.method({
    method: "POST",
    fullPath: "/v1/billing/credit_grants/{id}/void",
  }),
});

export function createCreditGrants(stripe: Stripe): CreditGrants {
  const resource = new CreditGrantsResource(
    stripe,
  ) as unknown as RawCreditGrantsResource;
  const options: Stripe.RequestOptions = {
    apiVersion: CREDIT_GRANTS_API_VERSION,
  };

  return {
    create: (params, extra) =>
      resource.create(params, {
        ...options,
        ...(extra?.idempotencyKey
          ? { idempotencyKey: extra.idempotencyKey }
          : {}),
      }),
    retrieve: (id) => resource.retrieve(id, {}, options),
    list: (params) => resource.list(params, options),
    void: (id) => resource.void(id, {}, options),
  };
}
