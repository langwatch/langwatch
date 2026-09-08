import type {
  SendUsageLimitWarningInput,
  UsageLimitWarning,
} from "@langwatch/entitlement-contract";

/**
 * The approaching-limit mail. Sending it needs the deployment's gateway, its
 * public host and the billing ladder the message quotes a next step from, none
 * of which this feature holds, so the send arrives as infrastructure.
 */
export abstract class UsageWarningPort {
  /** Reports nothing sent when the reading crossed no threshold, or the window still holds. */
  abstract sendWarning(input: SendUsageLimitWarningInput): Promise<UsageLimitWarning>;
}
