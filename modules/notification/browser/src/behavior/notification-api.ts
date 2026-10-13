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

/** Where the next page resumes: the last row of the page before. */
export type EmailSuppressionCursor = { createdAt: TimeInput; id: string };

export type NotificationApiMap = {
  emailSuppression: {
    /** One page, newest first; `nextCursor` is null on the last page. */
    getPage: {
      query: {
        input: ProjectScope & { limit?: number; cursor?: EmailSuppressionCursor | null };
        output: { suppressions: EmailSuppressionRow[]; nextCursor: EmailSuppressionCursor | null };
      };
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
