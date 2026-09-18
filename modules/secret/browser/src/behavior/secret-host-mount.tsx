/**
 * Secret's answer to the port its screen declares: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ComponentType, type ReactNode } from "react";

import {
  SecretHostApi,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "../model/secret-host.ts";

class CapabilitySecretHost extends SecretHostApi {
  constructor(
    private readonly projectId: string | undefined,
    private readonly session: UiSession,
    private readonly feedback: UiFeedback,
  ) {
    super();
  }

  scope(): SecretHostScope {
    return { projectId: this.projectId, projectName: void 0 };
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  succeeded(notice: SecretSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: SecretFailureNotice): void {
    this.feedback.failed(failure);
  }

  /** No switcher capability exists, and this port says null is an answer. */
  projectSwitcher(): ReactNode | null {
    return null;
  }
}

/** Wraps one screen in this module's host, so no route renders without it. */
export function withSecretHost(Screen: ComponentType): ComponentType {
  return function SecretHostMount() {
    const { session, feedback } = useUiCapabilities();
    const { projectId } = useUiScope().activeScope();
    const host = useMemo(
      () => new CapabilitySecretHost(projectId ?? void 0, session, feedback),
      [projectId, session, feedback],
    );
    return (
      <SecretHostProvider value={host}>
        <Screen />
      </SecretHostProvider>
    );
  };
}
