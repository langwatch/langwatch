/**
 * API procedures for email suppressions. Segment name (emailSuppression) is
 * load-bearing for React Query cache keys; mount point is from
 * automation-server.
 */

import { type ModuleApi, createModuleApi } from "@langwatch/api/web";
import type { TimeInput } from "@langwatch/time";

/** The project every suppression procedure is scoped to. */
type ProjectScope = { projectId: string };

/**
 * One suppressed recipient.
 *
 * `triggerId === null` means the address opted out of EVERY notification this
 * project sends, which is what the table's red badge says; a trigger id narrows
 * it to one notification, and `triggerName` is enriched server-side so the
 * scope renders without a second round trip.
 */
export type EmailSuppressionRow = {
  id: string;
  email: string;
  triggerId: string | null;
  triggerName: string | null;
  reason: string | null;
  createdAt: TimeInput;
};

export type NotificationApiMap = {
  emailSuppression: {
    getAll: {
      query: { input: ProjectScope; output: EmailSuppressionRow[] };
    };

    /** Removing a suppression resumes delivery — a deliberate operator action. */
    remove: {
      mutation: { input: ProjectScope & { id: string }; output: { ok: boolean } };
    };
  };
};

/**
 * The notification family's typed tRPC hooks. Same machinery, same transport
 * and same React Query cache as the application's `api` proxy.
 */
export const notificationApi: ModuleApi<NotificationApiMap> = createModuleApi<NotificationApiMap>();
