/**
 * Insight's answer to its port: every method projects a `@langwatch/browser-host`
 * capability, so the module mounts it, not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiHostServices,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { useLentOperations } from "@langwatch/browser-host/lent";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { type LangyAsk, LangyAskToken } from "@langwatch/langy-client";
import type { LangyAskRequest } from "@langwatch/langy-contract";
import { type ReactNode, useMemo } from "react";

import {
  InsightHostApi,
  InsightHostProvider,
  type InsightFailureNotice,
  type InsightHostProject,
  type InsightSuccessNotice,
} from "../model/insight-host.ts";

/**
 * The one DOM ability no capability carries, written the way `@langwatch/browser-host`'s own
 * `CopyButton` writes it. A page served without a secure origin has no clipboard.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

class CapabilityInsightHost extends InsightHostApi {
  constructor(
    private readonly deps: {
      project: InsightHostProject | undefined;
      enabled: boolean | undefined;
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
    return this.deps.enabled;
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

  copyToClipboard(text: string): Promise<boolean> {
    return writeToClipboard(text);
  }

  askLangy(request: LangyAskRequest): void {
    if (!this.deps.langy) return;
    void this.deps.langy().then((langy) => langy.ask(request));
  }
}

/** One provider above the routed tree; default-exported because `mounts.load` resolves it. */
export default function InsightHostMount({ children }: { children?: ReactNode }) {
  const { session, route, navigation, feedback } = useUiHostServices();
  const langy = useLentOperations(LangyAskToken);
  // Read as a primitive: the flags service hands a new object on every render.
  const enabled = useUiFlags().flag(FrontendFlags.release_insights);
  const scopeProject = session.snapshot().scope.project;
  const projectId = scopeProject?.id;
  const projectSlug = scopeProject?.slug;
  const projectKind = scopeProject?.kind;

  const host = useMemo(
    () =>
      new CapabilityInsightHost({
        project:
          projectId !== void 0 && projectSlug !== void 0
            ? {
                id: projectId,
                slug: projectSlug,
                ...(projectKind !== void 0 ? { kind: projectKind } : {}),
              }
            : void 0,
        enabled,
        session,
        route,
        navigation,
        feedback,
        langy,
      }),
    [projectId, projectSlug, projectKind, enabled, session, route, navigation, feedback, langy],
  );
  return <InsightHostProvider value={host}>{children}</InsightHostProvider>;
}
