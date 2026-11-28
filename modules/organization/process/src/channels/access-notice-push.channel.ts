/** One in-app push about a seat request, as the access notice service hands it over. */
export type AccessNoticePush = Readonly<{
  userId: string;
  organizationId: string;
  /** A live project of the organization, the tenant notification records the push on. */
  projectId: string;
  idempotencyKey: string;
  /** Groups the pushes about one seat request, so a newer one replaces the older. */
  topic: string;
  title: string;
  body: string;
  /** Where a click goes, a path on this installation's origin. */
  url: string;
}>;

/**
 * The Web Push side of seat requests: administrators and Billing members hear a member asked,
 * and the member hears the answer. Who is told is the access notice service's decision.
 */
export abstract class AccessNoticePushChannel {
  abstract push(input: AccessNoticePush): Promise<void>;
}
