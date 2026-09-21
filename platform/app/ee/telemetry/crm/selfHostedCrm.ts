/**
 * What the CRM side of the self-hosted registry needs from the rest of the
 * application (ADR-139, section 10).
 *
 * No new vendor: Customer.io carries the traits and the events, and the
 * existing Slack notifications carry the signal a person reads.
 */

import type { SelfHostedInstanceRecord } from "../instances/selfHostedInstances";
import type { SelfHostedSignal } from "./selfHostedSignals";

/** The person Customer.io object traits are written through. */
export interface CloudCustomer {
  userId: string;
  organizationName: string;
}

/**
 * Lookups that reach LangWatch Cloud's own tables.
 *
 * Customer.io writes object traits through a person, so setting a trait on an
 * organization needs one of its members. Which one does not matter, as long as
 * it is the same one every time, so two reports do not write the same traits
 * through two different people.
 */
export interface CloudCustomerLookup {
  findRepresentative(organizationId: string): Promise<CloudCustomer | null>;
  /**
   * Whether anybody with an address on this domain has a LangWatch Cloud
   * account. This is the join that turns an anonymous install into a company
   * a salesperson already has a thread with.
   */
  hasAccountOnDomain(domain: string): Promise<boolean>;
}

/** Everything the announcement needs to say who this install is. */
export interface SignalAnnouncement {
  signals: SelfHostedSignal[];
  instance: SelfHostedInstanceRecord;
  leadingDomain: string | null;
  organizationId: string | null;
}

/** Where a raised signal goes. */
export interface SelfHostedCrm {
  hasAccountOnDomain(domain: string): Promise<boolean>;
  announce(announcement: SignalAnnouncement): Promise<void>;
}
