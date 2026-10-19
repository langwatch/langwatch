/** Test host and harness for public annotation surfaces. */

import type { UiScopeStatus } from "@langwatch/browser-host/session";
import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, type RenderResult } from "@testing-library/react";
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";

import {
  AnnotationHostApi,
  AnnotationHostProvider,
  type AnnotationFailureNotice,
  type AnnotationHostProject,
  type AnnotationHostUser,
  type AnnotationRouteReading,
  type AnnotationSuccessNotice,
  type AnnotationTraceFilters,
} from "./model/annotation-host.ts";

export type StubAnnotationHostOptions = {
  project?: AnnotationHostProject | undefined;
  /** How the active scope reads; ready unless a test says otherwise. */
  scopeStatus?: UiScopeStatus;
  organizationId?: string | undefined;
  currentUser?: AnnotationHostUser | undefined;
  permissions?: readonly string[];
  isLiteMember?: boolean;
  isOwnPersonalWorkspace?: boolean;
  route?: AnnotationRouteReading;
  /** The trace filters the shell passes in; absent means the list is unfiltered. */
  traceFilters?: AnnotationTraceFilters;
  /** The drawer the address bar has open, if any. */
  openDrawer?: string;
};

/** A host that answers from fixtures and records everything it is told. */
export class StubAnnotationHost extends AnnotationHostApi {
  readonly successes: AnnotationSuccessNotice[] = [];
  readonly failures: AnnotationFailureNotice[] = [];
  readonly navigations: string[] = [];
  readonly queries: Readonly<Record<string, string | undefined>>[] = [];
  readonly drawers: { name: string; params?: Readonly<Record<string, unknown>> }[] = [];
  /** The drawer the address bar names; a test clears it to close the drawer. */
  /** One box shared with the harness's per-change views of this host. */
  readonly drawer = {
    name: undefined as string | undefined,
    version: 0,
    listeners: new Set<() => void>(),
  };

  constructor(private readonly options: StubAnnotationHostOptions = {}) {
    super();
    this.drawer.name = options.openDrawer;
  }

  get openDrawerName(): string | undefined {
    return this.drawer.name;
  }

  set openDrawerName(name: string | undefined) {
    this.drawer.name = name;
    this.drawer.version += 1;
    this.drawer.listeners.forEach((listener) => listener());
  }

  /** What the harness listens to, so a changed drawer reaches a memoised reader. */
  readonly subscribeToDrawer = (listener: () => void): (() => void) => {
    this.drawer.listeners.add(listener);
    return () => void this.drawer.listeners.delete(listener);
  };

  readonly drawerSnapshot = (): number => this.drawer.version;

  project(): AnnotationHostProject | undefined {
    return "project" in this.options
      ? this.options.project
      : { id: "proj-1", slug: "test-project", name: "Test Project" };
  }

  scopeStatus(): UiScopeStatus {
    return this.options.scopeStatus ?? "ready";
  }

  organizationId(): string | undefined {
    return "organizationId" in this.options ? this.options.organizationId : "org-1";
  }

  currentUser(): AnnotationHostUser | undefined {
    return "currentUser" in this.options
      ? this.options.currentUser
      : { id: "user-1", name: "Ana Reviewer", image: null };
  }

  hasPermission(permission: string): boolean {
    return (
      this.options.permissions ?? ["annotations:view", "annotations:update", "project:view"]
    ).includes(permission);
  }

  isLiteMember(): boolean {
    return this.options.isLiteMember ?? false;
  }

  isOwnPersonalWorkspace(): boolean {
    return this.options.isOwnPersonalWorkspace ?? false;
  }

  route(): AnnotationRouteReading {
    return this.options.route ?? { params: {}, query: {} };
  }

  traceFilters(): AnnotationTraceFilters | undefined {
    return this.options.traceFilters;
  }

  setQuery(next: Readonly<Record<string, string | undefined>>): void {
    this.queries.push(next);
  }

  navigate(to: string): void {
    this.navigations.push(to);
  }

  openDrawer(name: string, params?: Readonly<Record<string, unknown>>): void {
    this.drawers.push(params ? { name, params } : { name });
    this.openDrawerName = name;
  }

  isDrawerOpen(name: string): boolean {
    return this.openDrawerName === name;
  }

  succeeded(notice: AnnotationSuccessNotice): void {
    this.successes.push(notice);
  }

  failed(failure: AnnotationFailureNotice): void {
    this.failures.push(failure);
  }

  /** The last query write, which is what an address assertion is about. */
  get lastQuery(): Readonly<Record<string, string | undefined>> | undefined {
    return this.queries.at(-1);
  }
}

const noSubscription = (): (() => void) => () => {};
const noSnapshot = (): number => 0;

/** The providers every annotations component needs before it can render. */
export function AnnotationTestHarness({
  host,
  children,
}: {
  host: AnnotationHostApi;
  children: ReactNode;
}) {
  "use no memo";
  useSyncExternalStore(
    host instanceof StubAnnotationHost ? host.subscribeToDrawer : noSubscription,
    host instanceof StubAnnotationHost ? host.drawerSnapshot : noSnapshot,
  );
  // The real host is a new value when the address changes; a stub that mutates in
  // place would leave a memoised reader of `isDrawerOpen` on the old answer.
  const reactiveHost: AnnotationHostApi = Object.create(host);

  return (
    <DesignSystemProvider forcedTheme="light">
      <AnnotationHostProvider value={reactiveHost}>{children}</AnnotationHostProvider>
    </DesignSystemProvider>
  );
}

/** Renders one element inside the harness and hands back the host it recorded on. */
export function renderWithAnnotationHost(
  element: ReactElement,
  options: StubAnnotationHostOptions = {},
): RenderResult & { host: StubAnnotationHost } {
  const host = new StubAnnotationHost(options);

  return {
    ...render(<AnnotationTestHarness host={host}>{element}</AnnotationTestHarness>),
    host,
  };
}
