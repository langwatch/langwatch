/**
 * Automation's answer to the port its screens declare: every method projects
 * a `@langwatch/browser-host` capability. The org/team graph and this
 * application's own address read honestly empty: no capability yet. §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import type { UiScopeHost } from "@langwatch/browser-host/use-organization-team-project";
import type { DatasetColumns } from "@langwatch/dataset-contract";
import { useMemo, type ReactNode } from "react";

import {
  AutomationHost,
  AutomationHostProvider,
  type AutomationDatasetCreation,
  type AutomationDrawer,
  type AutomationFailureNotice,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationRouteReading,
  type AutomationScope,
  type AutomationSuccessNotice,
  type AutomationTeam,
} from "../model/automation-host.ts";

/** Writes a registered drawer's address, clearing every stale `drawer.*` key. */
function openDrawerAddress({
  drawer,
  params,
  route,
}: {
  drawer: string;
  params?: Readonly<Record<string, string | undefined>>;
  route: UiRoute;
}): void {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(route.reading().query)) {
    next[key] = key.startsWith("drawer.") ? void 0 : value;
  }
  next["drawer.open"] = drawer;
  for (const [key, value] of Object.entries(params ?? {})) next[`drawer.${key}`] = value;
  route.setQuery(next);
}

class CapabilityAutomationHost extends AutomationHost {
  constructor(
    private readonly hostScope: AutomationScope,
    private readonly currentProject: AutomationProject | undefined,
    private readonly session: UiSession,
    private readonly navigation: UiNavigation,
    private readonly uiRoute: UiRoute,
    private readonly feedback: UiFeedback,
    private readonly openRegisteredDrawer: ReturnType<typeof useDrawer>["openDrawer"],
    private readonly goBackDrawer: ReturnType<typeof useDrawer>["goBack"],
  ) {
    super();
  }

  scope(): AutomationScope {
    return this.hostScope;
  }

  /** No org-graph capability exists yet; recorded gap, see the handoff. */
  organization(): AutomationOrganization | undefined {
    return void 0;
  }

  /** Same recorded gap: a compliant `slug` cannot be built from the current scope alone. */
  team(): AutomationTeam | undefined {
    return void 0;
  }

  project(): AutomationProject | undefined {
    return this.currentProject;
  }

  hasPermission(permission: string): boolean {
    return this.session.hasPermission(permission);
  }

  isFeatureEnabled(flag: string): boolean {
    return this.session.isFeatureEnabled(flag);
  }

  featureFlag(flag: string): boolean | undefined {
    return this.session.featureFlag(flag);
  }

  route(): AutomationRouteReading {
    const { params, query } = this.uiRoute.reading();
    return { params, query };
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.uiRoute.setQuery(next, options);
  }

  navigate(to: string): void {
    this.navigation.navigate(to);
  }

  openDrawer(request: {
    drawer: AutomationDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    openDrawerAddress({ drawer: request.drawer, params: request.params, route: this.uiRoute });
  }

  /** The one sub-flow this family runs: the dataset module's own drawer, hands over and returns. */
  createDataset(handover: {
    created: (dataset: AutomationDatasetCreation) => void;
    returned: () => void;
  }): void {
    this.openRegisteredDrawer("addOrEditDataset", {
      onSuccess: (saved: { datasetId: string; columnTypes: DatasetColumns }) =>
        handover.created({ datasetId: saved.datasetId, columnTypes: saved.columnTypes }),
      onClose: () => {
        handover.returned();
        this.goBackDrawer();
      },
    });
  }

  /** No deployment-address capability exists yet; recorded gap, see the handoff. */
  appBaseUrl(): string {
    return "";
  }

  succeeded(notice: AutomationSuccessNotice): void {
    this.feedback.succeeded(notice);
  }

  failed(failure: AutomationFailureNotice): void {
    this.feedback.failed(failure);
  }

  describeFailure(failure: AutomationFailureNotice): string {
    return (
      failure.title ??
      resolveUiFailureCopy({ error: failure.error, fallbackTitle: failure.fallbackTitle }).title
    );
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AutomationHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { organizationId, projectId } = useUiScope().activeScope();
  const scopeHost: UiScopeHost | undefined = useUiScope().scopeHost();
  const { openDrawer: openRegisteredDrawer, goBack } = useDrawer();

  const hostScope = useMemo<AutomationScope>(
    () => ({ organizationId, teamId: scopeHost?.team()?.id ?? null, projectId }),
    [organizationId, projectId, scopeHost],
  );

  const project = useMemo<AutomationProject | undefined>(() => scopeHost?.project(), [scopeHost]);

  const host = useMemo(
    () =>
      new CapabilityAutomationHost(
        hostScope,
        project,
        session,
        navigation,
        route,
        feedback,
        openRegisteredDrawer,
        goBack,
      ),
    [hostScope, project, session, navigation, route, feedback, openRegisteredDrawer, goBack],
  );

  return <AutomationHostProvider value={host}>{children}</AutomationHostProvider>;
}
