import type { UsageLimitEmailData } from "../services/billing-usage-notice.service.ts";

/**
 * The approaching-limit mail, as billing hands it over.
 *
 * Billing owns none of it: the envelope, the template and the sender belong
 * to the process's mail composition, so it is a channel rather than a service.
 * The memory tier accepts and drops, for a process that composes no mailer at
 * all.
 */
export abstract class UsageLimitEmailChannel {
  abstract send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void>;
}
