import { createLogger } from "@langwatch/observability";

/**
 * What every lifecycle signal shares. The sink itself is composed by `BillingApp` and handed
 * to each signal; a deployment with no Customer.io key hands none, and the signal sends nothing.
 */
const nurturingLogger = createLogger("langwatch:billing:nurturing");

/** Resolves an organization admin for a project, when no actor is in hand. */
export type OrganizationAdminResolver = (
  projectId: string,
) => Promise<{ userId: string; organizationId: string } | null>;

/**
 * Where a fire-and-forget lifecycle signal's failure goes. Warn rather than error, and
 * swallowed rather than rethrown: the caller has already done the thing the customer asked
 * for, and a Customer.io outage is not the customer's problem.
 */
export function reportFailure(error: unknown): void {
  nurturingLogger.warn({ error }, "a lifecycle signal could not be delivered");
}
