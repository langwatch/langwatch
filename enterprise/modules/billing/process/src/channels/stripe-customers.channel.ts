// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The customers subject of billing's Stripe channels (Q69): the customer a
 * checkout is raised against, created once per organization and read for the
 * currency Stripe has fixed on it.
 */

/** A customer as Stripe holds it: deleted, or live with the currency it is fixed to, if any. */
export type StripeCustomer =
  | Readonly<{ id: string; deleted: true }>
  | Readonly<{ id: string; deleted: false; currency: string | null }>;

export abstract class StripeCustomersChannel {
  abstract createCustomer(input: { email: string; name: string }): Promise<{ id: string }>;

  abstract deleteCustomer(input: { customerId: string }): Promise<void>;

  /** Throws the provider's `resource_missing` refusal for a customer it never held. */
  abstract getCustomer(input: { customerId: string }): Promise<StripeCustomer>;
}
