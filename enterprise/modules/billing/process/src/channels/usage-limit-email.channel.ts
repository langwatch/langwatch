import type { UsageLimitEmailData } from "../services/billing-usage-notice.service.ts";

/**
 * The approaching-limit mail, as billing hands it over. Billing owns none
 * of it — envelope, template and sender belong to the mail composition,
 * hence a channel, not a service. The memory tier accepts and drops.
 */
export abstract class UsageLimitEmailChannel {
  abstract send(input: {
    to: string;
    organizationName: string;
    usage: UsageLimitEmailData;
  }): Promise<void>;
}
