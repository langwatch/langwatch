/** One subscription, in the shape the duplicate-subscription report groups on. */
export type SubscriptionReportRow = Readonly<{
  id: string;
  organizationId: string;
  plan: string;
  status: string;
  createdAt: Date;
  stripeSubscriptionId: string | null;
}>;

/** The two SELECTs the duplicate-subscription report makes, and nothing else. */
export abstract class DuplicateSubscriptionsReportRepository {
  abstract findByStatus(status: string): Promise<SubscriptionReportRow[]>;
}
