/**
 * Annotation's answer to the port its screens declare: every method
 * projects a `@langwatch/browser-host` capability, so the module mounts it,
 * not the application. ARCHITECTURE.md §10.1.
 */

import {
  useUiCapabilities,
  useUiScope,
  type UiFeedback,
  type UiNavigation,
  type UiRoute,
  type UiSession,
} from "@langwatch/browser-host/capabilities";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useMemo, type ReactNode } from "react";

import {
  AnnotationHostApi,
  AnnotationHostProvider,
  type AnnotationFailureNotice,
  type AnnotationHostProject,
  type AnnotationHostUser,
  type AnnotationRouteReading,
  type AnnotationSuccessNotice,
} from "../model/annotation-host.ts";

class CapabilityAnnotationHost extends AnnotationHostApi {
  constructor(
    private readonly deps: {
      organizationId: string | undefined;
      project: AnnotationHostProject | undefined;
      isLiteMember: boolean;
      session: UiSession;
      navigation: UiNavigation;
      route: UiRoute;
      feedback: UiFeedback;
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

  /** No capability answers ownership of the reader's own personal workspace. */
  isOwnPersonalWorkspace(): boolean {
    return false;
  }

  route(): AnnotationRouteReading {
    const reading = this.deps.route.reading();

    return { params: reading.params, query: reading.query };
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

  succeeded(notice: AnnotationSuccessNotice): void {
    this.deps.feedback.succeeded(notice);
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
  const { session, navigation, route, feedback } = useUiCapabilities();
  const uiScope = useUiScope();
  const { organizationId } = uiScope.activeScope();
  const scopeHost = uiScope.scopeHost();
  const hostProject = scopeHost?.project();
  const isLiteMember = scopeHost?.organizationRole() === "EXTERNAL";
  const { openDrawer, drawerOpen } = useDrawer();

  const host = useMemo(
    () =>
      new CapabilityAnnotationHost({
        organizationId: organizationId ?? void 0,
        project: hostProject
          ? { id: hostProject.id, slug: hostProject.slug, name: hostProject.name }
          : void 0,
        isLiteMember,
        session,
        navigation,
        route,
        feedback,
        drawers: { openDrawer, drawerOpen },
      }),
    [
      organizationId,
      hostProject,
      isLiteMember,
      session,
      navigation,
      route,
      feedback,
      openDrawer,
      drawerOpen,
    ],
  );

  return <AnnotationHostProvider value={host}>{children}</AnnotationHostProvider>;
}
