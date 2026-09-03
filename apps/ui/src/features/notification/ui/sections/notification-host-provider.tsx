/**
 * What the Email Suppressions screen is mounted inside.
 *
 * Two things go around `/settings/email-suppressions`: the tRPC Provider the
 * package's own hooks run on, and the host port that answers for the project,
 * the manage grant and the two notices.
 *
 * THE PROJECT IS THE SESSION'S ACTIVE SCOPE. `platform/app` read it off
 * `useOrganizationTeamProject`, which resolves the whole organization graph for
 * one id; the capability layer already holds that id and the read takes nothing
 * else, so no graph is fetched for this page at all.
 */

import { NotificationHostProvider } from "@langwatch/notification-web/screens/email-suppressions";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiNotificationHost } from "../../behavior/notification-host.adapter";

function NotificationHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = session.activeScope();

  const host = useMemo(
    () =>
      UiNotificationHost.create(
        { project: projectId ? { id: projectId } : void 0 },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [projectId, session, feedback],
  );

  return <NotificationHostProvider value={host}>{children}</NotificationHostProvider>;
}

/** Wraps the Email Suppressions screen in the host its package asks for. */
export function withNotificationHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <NotificationHost>
      <Screen {...props} />
    </NotificationHost>
  );
  Mounted.displayName = `withNotificationHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
