import type { WebPushSubscription } from "@langwatch/notification-contract";
import type { Instant } from "@langwatch/time";

/** One browser as a subscribe call stores it. */
export interface WebPushSubscriptionWrite {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/** The browsers people subscribed to Web Push, one row per endpoint. */
export interface WebPushSubscriptionRepository {
  /** Stores the browser; an endpoint already stored is rewritten, moving to this person. */
  upsert(input: WebPushSubscriptionWrite): Promise<WebPushSubscription>;
  findById(id: string): Promise<WebPushSubscription | null>;
  findByUser(userId: string): Promise<WebPushSubscription[]>;
  /** Removes the person's browser at that endpoint; another person's row is left alone. */
  deleteForUser(input: { userId: string; endpoint: string }): Promise<void>;
  /** Removes a browser the push service no longer knows. */
  deleteById(id: string): Promise<void>;
  /** Removes every browser of a person who left. */
  deleteAllForUser(userId: string): Promise<number>;
  recordSuccess(input: { id: string; at: Instant }): Promise<void>;
}
