/**
 * The procedures this package calls, and the hooks that call them.
 *
 * HAND-WRITTEN FOR NOW, MEANT TO BE GENERATED, exactly as every other feature
 * family's map says of itself.
 *
 * THE SEGMENT NAME IS LOAD-BEARING. `emailSuppression` is a mount point on the
 * root router and tRPC hashes that path into the React Query cache key; spell
 * it differently and this screen quietly stops sharing a cache with the
 * unsubscribe pair the mail client hits.
 *
 * THE MOUNT IS NOT THIS PACKAGE'S FEATURE, and that is recorded rather than
 * hidden: `emailSuppression.*` is mounted from `@langwatch/automation-server`
 * and the row's helpers live in `@langwatch/automation-contract`. Addressing a
 * neighbour's mount point by its string costs this package nothing — the
 * analytics family's argument — and the row shape below is the producer's own,
 * field for field with what `getAll` returns.
 *
 * THIS MODULE IS THE ONE GOVERNED-CLOSURE EXCEPTION IN THE PACKAGE. ADR-004
 * seals a screen's closure off from `@langwatch/platform-api-client`, and the
 * import below is the only one in the package.
 */

import { createFeatureApi } from "@langwatch/platform-api-client";

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
  createdAt: Date;
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
export const notificationApi = createFeatureApi<NotificationApiMap>();
