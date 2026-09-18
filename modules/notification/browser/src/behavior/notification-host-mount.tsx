/**
 * Notification's answer to the port its screen declares: every method
 * projects a `@langwatch/browser-host` capability. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  NotificationHostApi,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "../model/notification-host.ts";

class CapabilityNotificationHost extends NotificationHostApi {
  constructor(
    private readonly hostProject: NotificationHostProject | undefined,
    private readonly session: UiSession,
    private readonly feedback: UiFeedback,
  ) {
    super();
  }

  project(): NotificationHostProject | undefined {
    return this.hostProject;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  succeeded(notice: NotificationSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: NotificationFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function NotificationHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { projectId } = useUiScope().activeScope();

  const host = useMemo(
    () => new CapabilityNotificationHost(projectId ? { id: projectId } : void 0, session, feedback),
    [projectId, session, feedback],
  );

  return <NotificationHostProvider value={host}>{children}</NotificationHostProvider>;
}
