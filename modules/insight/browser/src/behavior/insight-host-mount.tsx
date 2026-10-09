/**
 * Insight's answer to its port: every method projects a `@langwatch/browser-host`
 * capability, so the module mounts it, not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { INSIGHTS_FLAG } from "@langwatch/insight-contract";
import { type LangyAsk, type LangyAskRequest, LangyAskToken } from "@langwatch/langy-contract";
import { type ReactNode, useMemo } from "react";

import {
  InsightHostApi,
  InsightHostProvider,
  type InsightFailureNotice,
  type InsightHostProject,
  type InsightSuccessNotice,
} from "../model/insight-host.ts";

class CapabilityInsightHost extends InsightHostApi {
  constructor(
    private readonly deps: {
      project: InsightHostProject | undefined;
      session: UiSession;
      route: UiRoute;
      navigation: UiNavigation;
      feedback: UiFeedback;
      langy: (() => Promise<LangyAsk>) | undefined;
    },
  ) {
    super();
  }

  project(): InsightHostProject | undefined {
    return this.deps.project;
  }

  isEnabled(): boolean | undefined {
    return this.deps.session.featureFlag(INSIGHTS_FLAG);
  }

  hasPermission(permission: string): boolean {
    return this.deps.session.hasPermission(permission);
  }

  query(): Readonly<Record<string, string | undefined>> {
    return this.deps.route.reading().query;
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.deps.route.setQuery(next, { replace: true });
  }

  navigate(to: string): void {
    this.deps.navigation.navigate(to);
  }

  succeeded(notice: InsightSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
  }

  failed(failure: InsightFailureNotice): void {
    this.deps.feedback.failed(failure);
  }

  askLangy(request: LangyAskRequest): void {
    if (!this.deps.langy) return;
    void this.deps.langy().then((langy) => langy.ask(request));
  }
}

/** One provider above the routed tree; default-exported because `mounts.load` resolves it. */
export default function InsightHostMount({ children }: { children?: ReactNode }) {
  const { session, route, navigation, feedback } = useUiCapabilities();
  const langy = useLentOperations(LangyAskToken);
  const scopeProject = session.snapshot().scope.project;
  const projectId = scopeProject?.id;
  const projectSlug = scopeProject?.slug;

  const host = useMemo(
    () =>
      new CapabilityInsightHost({
        project:
          projectId !== void 0 && projectSlug !== void 0
            ? { id: projectId, slug: projectSlug }
            : void 0,
        session,
        route,
        navigation,
        feedback,
        langy,
      }),
    [projectId, projectSlug, session, route, navigation, feedback, langy],
  );
  return <InsightHostProvider value={host}>{children}</InsightHostProvider>;
}
