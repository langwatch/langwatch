/**
 * Annotation's answer to the port its screens declare: every method
 * projects a `@langwatch/browser-host` host service, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiHostServices,
  useUiScope,
  useUiTraceFilters,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
  type UiTraceFilters,
} from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/drawer";
import type { UiScopeStatus } from "@langwatch/browser-host/session";
import { useMemo, type ReactNode } from "react";

import {
  AnnotationHostApi,
  AnnotationHostProvider,
  type AnnotationFailureNotice,
  type AnnotationHostProject,
  type AnnotationHostUser,
  type AnnotationRouteReading,
  type AnnotationSuccessNotice,
  type AnnotationTraceFilters,
} from "../model/annotation-host.ts";
import { isOwnPersonalWorkspace } from "../model/annotation-personal-workspace.ts";
import { annotationApi } from "./annotation-api.ts";

class HostServiceAnnotationHost extends AnnotationHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      project: AnnotationHostProject | undefined;
      scopeStatus: UiScopeStatus;
      isLiteMember: boolean;
      isOwnPersonalWorkspace: boolean;
      session: UiSession;
      navigation: UiNavigation;
      route: UiRoute;
      feedback: UiFeedback;
      /** Undefined where no module lent it: no filters applied. */
      traceFilters: UiTraceFilters | undefined;
      drawers: {
        openDrawer: (drawer: string, props?: Record<string, unknown>) => void;
        drawerOpen: (drawer: string) => boolean;
      };
    },
  ) {
    super();
  }

  project(): AnnotationHostProject | undefined {
    return this.deps.project;
  }

  scopeStatus(): UiScopeStatus {
    return this.deps.scopeStatus;
  }

  organizationId(): string | undefined {
    return this.deps.organizationId;
  }

  currentUser(): AnnotationHostUser | undefined {
    const actor = this.deps.session.currentUser();

    return actor ? { id: actor.id, name: actor.name, image: actor.image } : void 0;
  }

  hasPermission(permission: string): boolean {
    return this.deps.session.hasPermission(permission);
  }

  isLiteMember(): boolean {
    return this.deps.isLiteMember;
  }

  isOwnPersonalWorkspace(): boolean {
    return this.deps.isOwnPersonalWorkspace;
  }

  route(): AnnotationRouteReading {
    const reading = this.deps.route.reading();

    return { params: reading.params, query: reading.query };
  }

  /** What analytics lends through the shell; undefined while nothing narrows the read. */
  traceFilters(): AnnotationTraceFilters | undefined {
    return this.deps.traceFilters?.applied();
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.deps.route.setQuery(next, options);
  }

  navigate(to: string): void {
    this.deps.navigation.navigate(to);
  }

  openDrawer(name: string, params?: Readonly<Record<string, unknown>>): void {
    this.deps.drawers.openDrawer(name, params ? { ...params } : void 0);
  }

  isDrawerOpen(name: string): boolean {
    return this.deps.drawers.drawerOpen(name);
  }

  succeeded({ action, ...notice }: AnnotationSuccessNotice): void {
    this.deps.feedback.succeeded({
      ...notice,
      ...(action ? { action: { label: action.label, run: action.perform } } : {}),
    });
  }

  failed(failure: AnnotationFailureNotice): void {
    this.deps.feedback.failed(failure);
  }
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function AnnotationHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiHostServices();
  const uiScope = useUiScope();
  const traceFilters = useUiTraceFilters();
  const { organizationId } = uiScope.activeScope();
  const scopeHost = uiScope.scopeHost();
  const hostProject = scopeHost?.project();
  const isLiteMember = scopeHost?.organizationRole() === "EXTERNAL";
  const scopeStatus = session.snapshot().scope.status;
  const { openDrawer, drawerOpen } = useDrawer();
  const userId = session.currentUser()?.id;
  const scopeGraph = annotationApi.organization.getScopeGraph.useQuery({}, { enabled: !!userId });
  const ownPersonal = isOwnPersonalWorkspace({
    graph: scopeGraph.data ?? [],
    projectId: hostProject?.id,
    userId,
  });

  const host = useMemo(
    () =>
      new HostServiceAnnotationHost({
        organizationId: organizationId ?? void 0,
        project: hostProject
          ? { id: hostProject.id, slug: hostProject.slug, name: hostProject.name }
          : void 0,
        scopeStatus,
        isLiteMember,
        isOwnPersonalWorkspace: ownPersonal,
        session,
        navigation,
        route,
        feedback,
        traceFilters,
        drawers: { openDrawer, drawerOpen },
      }),
    [
      organizationId,
      hostProject,
      scopeStatus,
      isLiteMember,
      ownPersonal,
      session,
      navigation,
      route,
      feedback,
      traceFilters,
      openDrawer,
      drawerOpen,
    ],
  );

  return <AnnotationHostProvider value={host}>{children}</AnnotationHostProvider>;
}
