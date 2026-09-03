/**
 * What the Email Suppressions screen is mounted inside: the tRPC Provider
 * its hooks run on, and the host port for project, grant and feedback. The
 * project is the session's active scope — no graph fetched for this page.
 */

import {
  NotificationHostProvider,
  type NotificationHostPort,
} from "@langwatch/notification-web/screens/email-suppressions";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";

export function NotificationHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = session.activeScope();

  const host = useMemo<NotificationHostPort>(
    () => ({
      project: () => (projectId ? { id: projectId } : void 0),
      hasPermission: (permission) => session.hasPermission(permission),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [projectId, session, feedback],
  );

  return <NotificationHostProvider value={host}>{children}</NotificationHostProvider>;
}
