/**
 * Evaluator's answer to the port its screens declare: every method projects
 * a `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiCopyTargets,
  useUiScope,
  type UiCopyTargets,
  type UiFeedback,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useMemo, type ReactNode } from "react";

import {
  EvaluatorHostApi,
  EvaluatorHostProvider,
  type EvaluatorCopyTarget,
  type EvaluatorFailureNotice,
  type EvaluatorOverlayRequest,
  type EvaluatorRouteReading,
  type EvaluatorScope,
  type EvaluatorSuccessNotice,
} from "../model/evaluator-host.ts";

class CapabilityEvaluatorHost extends EvaluatorHostApi {
  private readonly hostScope: EvaluatorScope;
  private readonly session: UiSession;
  private readonly lent: UiCopyTargets;
  private readonly uiRoute: UiRoute;
  private readonly feedback: UiFeedback;

  constructor({
    hostScope,
    session,
    lent,
    uiRoute,
    feedback,
  }: {
    hostScope: EvaluatorScope;
    session: UiSession;
    lent: UiCopyTargets;
    uiRoute: UiRoute;
    feedback: UiFeedback;
  }) {
    super();
    this.hostScope = hostScope;
    this.session = session;
    this.lent = lent;
    this.uiRoute = uiRoute;
    this.feedback = feedback;
  }

  scope(): EvaluatorScope {
    return this.hostScope;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  /** Organization's lent targets; no answer yet is no target (§10.1, array port). */
  copyTargets(): readonly EvaluatorCopyTarget[] {
    return (this.lent.targets("evaluations:manage") ?? []).map((target) => ({
      id: target.projectId,
      name: target.label,
      canCreate: target.mayCreate,
    }));
  }

  route(): EvaluatorRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  openOverlay(request: EvaluatorOverlayRequest): void {
    const next: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(this.uiRoute.reading().query)) {
      next[key] = key.startsWith("drawer.") ? void 0 : value;
    }
    next["drawer.open"] = request.drawer;
    for (const [key, value] of Object.entries(request.params ?? {})) next[`drawer.${key}`] = value;
    this.uiRoute.setQuery(next);
  }

  succeeded(notice: EvaluatorSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: EvaluatorFailureNotice): void {
    this.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function EvaluatorHostMount({ children }: { children?: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const lent = useUiCopyTargets();
  const { projectId } = useUiScope().activeScope();
  const scopeHost = useUiScope().scopeHost();

  const hostScope = useMemo<EvaluatorScope>(
    () => ({ projectId: projectId ?? undefined, projectSlug: scopeHost?.project()?.slug }),
    [projectId, scopeHost],
  );

  const host = useMemo(
    () => new CapabilityEvaluatorHost({ hostScope, session, lent, uiRoute: route, feedback }),
    [hostScope, session, lent, route, feedback],
  );

  return <EvaluatorHostProvider value={host}>{children}</EvaluatorHostProvider>;
}
