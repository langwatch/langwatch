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
 * A null triggerId opts out of every notification; otherwise triggerName is
 * enriched server-side to avoid another round trip.
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
