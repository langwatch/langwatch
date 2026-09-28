/**
 * Authz's answer to the port its screens declare: each method projects a
 * `@langwatch/browser-host` capability or the plan it reads itself, so the
 * module mounts it, not the application. ARCHITECTURE.md §10.1.
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
  type AuthzRouteReading,
  type AuthzSuccessNotice,
} from "../model/authz-host.ts";
import { authzApi } from "./authz-api.ts";

class CapabilityAuthzHost extends AuthzHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      session: UiSession;
      feedback: UiFeedback;
      plan: AuthzPlanReading;
      route: AuthzRouteReading;
      setQuery: AuthzHostApi["setQuery"];
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
    return this.deps.plan;
  }

  route(): AuthzRouteReading {
    return this.deps.route;
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.setQuery(next, options);
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
  const { session, feedback, route } = useUiCapabilities();
  const { query } = route.reading();
  const { organizationId } = useUiScope().activeScope();
  // The same question, gate and cache entry as the navigation's plan reading.
  const usage = authzApi.limits.getUsage.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && session.hasPermission("organization:view"), retry: false },
  );
  const planType = usage.data?.activePlan.type;
  const plan = useMemo(
    () => ({ isEnterprise: planType === "ENTERPRISE", isLoading: usage.isLoading }),
    [planType, usage.isLoading],
  );
  const host = useMemo(
    () =>
      new CapabilityAuthzHost({
        organizationId: organizationId ?? void 0,
        session,
        feedback,
        plan,
        route: { query },
        setQuery: (next, options) => route.setQuery(next, options),
      }),
    [organizationId, session, feedback, plan, query, route],
  );
  return <AuthzHostProvider value={host}>{children}</AuthzHostProvider>;
}
