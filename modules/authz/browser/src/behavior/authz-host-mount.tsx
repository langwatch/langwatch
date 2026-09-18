/**
 * Authz's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  AuthzHostApi,
  AuthzHostProvider,
  type AuthzFailureNotice,
  type AuthzHostScope,
  type AuthzPlanReading,
  type AuthzSuccessNotice,
} from "../model/authz-host.ts";

/** No capability carries the plan tier yet, so the enterprise gate reads closed. */
const NO_PLAN: AuthzPlanReading = { isEnterprise: false, isLoading: false };

class CapabilityAuthzHost extends AuthzHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      session: UiSession;
      feedback: UiFeedback;
    },
  ) {
    super();
  }

  scope(): AuthzHostScope {
    return { organizationId: this.deps.organizationId };
  }

  hasPermission(permission: string): boolean {
    return this.deps.session.hasPermission(permission);
  }

  plan(): AuthzPlanReading {
    return NO_PLAN;
  }

  succeeded(notice: AuthzSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: AuthzFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AuthzHostMount({ children }: { children?: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { organizationId } = useUiScope().activeScope();
  const host = useMemo(
    () => new CapabilityAuthzHost({ organizationId: organizationId ?? void 0, session, feedback }),
    [organizationId, session, feedback],
  );
  return <AuthzHostProvider value={host}>{children}</AuthzHostProvider>;
}
