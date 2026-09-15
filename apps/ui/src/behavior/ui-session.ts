/**
 * The session capability: who is here, what scope, what they may do, what
 * is switched on. All FOUR ANSWER SYNCHRONOUSLY AND FAIL CLOSED — a
 * permission that flickers open while loading is a permission that leaked.
 */

import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import {
  createUiScopeHost,
  type UiScopeHost,
} from "@langwatch/ui-host/use-organization-team-project";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { UiActiveScope, UiActor, UiFeedback } from "@langwatch/ui-host/capabilities";
import { UiSession } from "@langwatch/ui-host/capabilities";
import type { UiSessionSnapshot } from "@langwatch/ui-host/session";
import type { UiResolvedScope, UiScopeProject } from "../model/ui-scope";
import { useUiAddress } from "./ui-address";
import { uiLeaveTo } from "./ui-departure";
import type { UiFeatureApiTransport } from "./ui-feature-transport";
import { readPublicAppConfig } from "./public-config";
import { resolveUiScope, uiScopeSelectionWrites } from "./ui-scope-resolution";
import { useUiRouteReading } from "./ui-scope-route";
import { rememberUiScopeSelection, useUiScopeMemory } from "./ui-scope-storage";
import {
  readUiActor,
  uiAuthClient,
  UI_SESSION_QUERY_KEY,
  type UiAuthClient,
  type UiSessionReading as UiSessionResponse,
} from "./ui-session-client";
import {
  useUiEffectivePermissions,
  useUiFeatureFlags,
  useUiOrganizations,
  useUiSharedProject,
  type UiEffectivePermissionsRead,
} from "./ui-session-queries";

/**
 * A composition's live session, built where the transport is — declared
 * as a source (a hook, called once) rather than a port, since the answer
 * changes as the reader navigates and the reads land.
 */
export type UiSessionSource = (input: {
  transport: UiFeatureApiTransport;
  /** Where a refused session read is told, since nobody else sees it. */
  feedback: UiFeedback;
}) => UiSession;

/** The screen a visitor with no session is sent to. */
export const UI_SIGN_IN_PATH = "/auth/signin";

/**
 * Where a visitor goes once the session read has answered — null means stay.
 */
export function uiSignedOutDeparture({
  actor,
  isAnswered,
  isPublicRoute,
  isOnline,
  isApiUnreachable,
  address,
}: {
  actor: UiActor | null;
  isAnswered: boolean;
  isPublicRoute: boolean;
  isOnline: boolean;
  /** Nothing answered, so nobody said this reader is signed out. */
  isApiUnreachable: boolean;
  address: string;
}): string | null {
  if (!isAnswered || actor !== null || isPublicRoute || !isOnline) return null;
  if (isApiUnreachable) return null;
  return `${UI_SIGN_IN_PATH}?callbackUrl=${encodeURIComponent(address)}`;
}

/**
 * The deployment's demo project slug, or nothing — absent config means no
 * demo project, never a crash: a shell with no config just has no demo
 * project, the same as a query that hasn't answered yet.
 */
export function readUiDemoProjectSlug(
  documentRoot?: Parameters<typeof readPublicAppConfig>[0],
): string | undefined {
  try {
    return (documentRoot ? readPublicAppConfig(documentRoot) : readPublicAppConfig())
      .demoProjectSlug;
  } catch {
    return void 0;
  }
}

/**
 * A screen names its flag mid-render, where React refuses a state update
 * — so the ask is recorded and broadcast on the microtask queue instead;
 * the render that asked finishes with `false`, the next has it in flight.
 */
export class UiFeatureFlagRequests {
  private readonly asked = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private ordered: readonly string[] = [];

  ask = (flag: string): void => {
    if (this.asked.has(flag)) return;
    this.asked.add(flag);
    this.ordered = [...this.asked];
    queueMicrotask(() => {
      for (const listener of this.listeners) listener();
    });
  };

  requested = (): readonly string[] => this.ordered;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export type BrowserUiSessionState = {
  readonly flags: ReadonlyMap<string, boolean>;
  readonly askFlag: (flag: string) => void;
  readonly scopeHost: UiScopeHost | undefined;
} & (
  | { readonly snapshot: UiSessionSnapshot }
  | {
      readonly actor: UiActor | null;
      readonly scope: UiActiveScope;
      readonly permissions: ReadonlySet<string> | undefined;
      readonly settled: boolean;
    }
);

/** The port over one render's worth of answers. */
export class BrowserUiSession extends UiSession {
  static create(state: BrowserUiSessionState): BrowserUiSession {
    return new BrowserUiSession(state);
  }

  private constructor(private readonly state: BrowserUiSessionState) {
    super();
  }

  currentUser(): UiActor | null {
    if ("snapshot" in this.state) return this.state.snapshot.session.user;
    return this.state.actor;
  }

  activeScope(): UiActiveScope {
    if ("snapshot" in this.state) {
      const { scope } = this.state.snapshot;
      return {
        organizationId: scope.organization?.id ?? null,
        projectId: scope.project?.id ?? null,
      };
    }
    return this.state.scope;
  }

  /**
   * Whether the caller holds a permission — applies the one hierarchy
   * rule the engine applies (`<resource>:manage` satisfies narrower
   * actions) through the engine's own helper, so the two can't drift.
   */
  hasPermission(permission: string): boolean {
    if ("snapshot" in this.state) return this.state.snapshot.permissions.can(permission);
    const granted = this.state.permissions;
    if (!granted) return false;
    return permissionSatisfiedBy({ granted, requested: permission });
  }

  isSettled(): boolean {
    if ("snapshot" in this.state) {
      const { session, scope, permissions } = this.state.snapshot;
      return session.status !== "loading" && scope.status !== "loading" && !permissions.isLoading;
    }
    return this.state.settled;
  }

  override snapshot(): UiSessionSnapshot {
    if (!("snapshot" in this.state)) return super.snapshot();
    return this.state.snapshot;
  }

  override scopeHost(): UiScopeHost | undefined {
    return this.state.scopeHost;
  }

  featureFlag(flag: string): boolean | undefined {
    const answer = this.state.flags.get(flag);
    if (answer === void 0) {
      this.state.askFlag(flag);
      return void 0;
    }
    return answer;
  }
}

/**
 * Install with `createUiApplication({ features: { session:
 * useBrowserUiSession } })`. Uninstalled, the refusing default is right
 * for a composition with no host to ask.
 */
export function useBrowserUiSession({
  transport,
  feedback,
  authClient,
}: {
  transport: UiFeatureApiTransport;
  feedback: UiFeedback;
  /** The deployment's own client unless a test answers with a recorded session. */
  authClient?: UiAuthClient;
}): UiSession {
  const route = useUiRouteReading();
  const address = useUiAddress();
  const memory = useUiScopeMemory();
  const [demoProjectSlug] = useState(readUiDemoProjectSlug);
  const [flagRequests] = useState(() => new UiFeatureFlagRequests());

  const session = useQuery({
    queryKey: UI_SESSION_QUERY_KEY,
    queryFn: () => readUiActor(authClient ?? uiAuthClient()),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const actor = session.data?.actor ?? null;
  const failure = session.data?.failure ?? null;
  const userId = actor?.id;

  // Once, per failed read, rather than once per render: the query holds its
  // answer, so the effect only re-runs when a re-read failed again.
  useEffect(() => {
    if (!failure) return;
    feedback.failed({ error: failure, fallbackTitle: "Couldn't check your session" });
  }, [failure, feedback]);

  const departure = uiSignedOutDeparture({
    actor,
    isAnswered: session.isSuccess,
    isPublicRoute: route.isPublicRoute,
    isOnline: navigator.onLine,
    isApiUnreachable: session.data?.unreachable === true,
    address,
  });

  useEffect(() => {
    if (departure === null) return;
    uiLeaveTo(departure);
  }, [departure]);

  // The demo project is addressed by the raw segment, reserved slugs included:
  // it is the URL naming the deployment's demo, not a project of the caller's.
  const isDemo = Boolean(demoProjectSlug && route.projectParam === demoProjectSlug);

  const organizations = useUiOrganizations({
    transport,
    isDemo,
    enabled: !!actor || !route.isPublicRoute,
    userId,
  });
  const sharedTrace = useUiSharedProject({
    transport,
    token: route.shareToken,
    enabled: !!route.shareToken && route.isPublicRoute,
  });

  const resolved = useMemo(
    () =>
      resolveUiScope({
        route,
        organizations: organizations.data,
        userId,
        selection: memory.selection,
        demoProjectSlug,
      }),
    [route, organizations.data, userId, memory.selection, demoProjectSlug],
  );

  // A share token resolves the project it addresses and nothing else: the
  // viewer has no membership anywhere, and the page is about the one view the
  // token opens. The organization stays whatever the reader's own session
  // resolved, which for a signed-out viewer is nothing.
  const isSharedRoute = Boolean(route.shareToken && route.isPublicRoute);
  const sharedProject = sharedTrace.data?.project;
  const project = isSharedRoute ? sharedProject : resolved.project;
  const organizationId = resolved.organization?.id;

  const permissions = useUiEffectivePermissions({
    transport,
    projectId: project?.id,
    organizationId,
    userId,
  });
  const organizationPermissions = useUiEffectivePermissions({
    transport,
    projectId: void 0,
    organizationId,
    userId,
  });

  const requestedFlags = useSyncExternalStore(
    flagRequests.subscribe,
    flagRequests.requested,
    flagRequests.requested,
  );
  const flags = useUiFeatureFlags({
    transport,
    flags: requestedFlags,
    projectId: project?.id ?? null,
    organizationId: organizationId ?? null,
    // A flag read that leaves out a scope it should have named cannot match
    // the rule that names it, so nothing is asked until the scope has settled.
    enabled: !organizations.isLoading,
  });

  const writes = useMemo(
    () =>
      uiScopeSelectionWrites({
        resolved,
        selection: memory.selection,
      }),
    [resolved, memory],
  );

  useEffect(() => {
    if (writes.length === 0) return;
    rememberUiScopeSelection({ writes });
  }, [writes]);

  const askFlag = useCallback((flag: string) => flagRequests.ask(flag), [flagRequests]);

  const sessionReading = readSession(session);
  const scope = readActiveScope({
    session: sessionReading,
    source: isSharedRoute ? sharedTrace : organizations,
    resolved,
    project,
  });
  const snapshot: UiSessionSnapshot = {
    session: sessionReading,
    scope,
    permissions: readPermissions(scope.status, permissions, organizationPermissions),
  };

  return BrowserUiSession.create({
    snapshot,
    flags,
    askFlag,
    scopeHost: legacyScopeHost(snapshot, resolved.organizationRole, isDemo),
  });
}

function readSession(query: UseQueryResult<UiSessionResponse>): UiSessionSnapshot["session"] {
  if (query.isLoading) return { status: "loading", user: null };
  if (query.data?.unreachable) return { status: "offline", user: null };
  if (query.isError || query.data?.failure) return { status: "error", user: null };
  const actor = query.data?.actor;
  if (actor) return { status: "authenticated", user: actor };
  return { status: "anonymous", user: null };
}

function readActiveScope({
  session,
  source,
  resolved,
  project,
}: {
  session: UiSessionSnapshot["session"];
  source: UseQueryResult<unknown>;
  resolved: UiResolvedScope;
  project: UiScopeProject | undefined;
}): UiSessionSnapshot["scope"] {
  const empty = { organization: void 0, team: void 0, project: void 0 };
  if (session.status === "loading" || source.isLoading) {
    return { ...empty, status: "loading" };
  }
  if (session.status === "offline" || session.status === "error" || source.isError) {
    return { ...empty, status: "unavailable" };
  }

  const { organization, team } = resolved;
  return {
    status: "ready",
    organization: organization ? { id: organization.id, name: organization.name } : void 0,
    team: team ? { id: team.id, name: team.name } : void 0,
    project: project
      ? { id: project.id, slug: project.slug, name: project.name ?? project.slug }
      : void 0,
  };
}

function readPermissions(
  scopeStatus: UiSessionSnapshot["scope"]["status"],
  project: UseQueryResult<UiEffectivePermissionsRead>,
  organization: UseQueryResult<UiEffectivePermissionsRead>,
): UiSessionSnapshot["permissions"] {
  const status = permissionStatus(scopeStatus, project, organization);
  const projectGrants = new Set(project.isError ? [] : project.data?.permissions);
  const organizationGrants = new Set(organization.isError ? [] : organization.data?.permissions);
  return {
    status,
    isLoading: status === "loading",
    can: (requested) =>
      scopeStatus === "ready" && permissionSatisfiedBy({ granted: projectGrants, requested }),
    canInOrganization: (requested) =>
      scopeStatus === "ready" && permissionSatisfiedBy({ granted: organizationGrants, requested }),
  };
}

function permissionStatus(
  scopeStatus: UiSessionSnapshot["scope"]["status"],
  project: UseQueryResult<UiEffectivePermissionsRead>,
  organization: UseQueryResult<UiEffectivePermissionsRead>,
): UiSessionSnapshot["permissions"]["status"] {
  if (scopeStatus !== "ready") return scopeStatus;
  if (project.isLoading || organization.isLoading) return "loading";
  if (project.isError || organization.isError) return "unavailable";
  return "ready";
}

function legacyScopeHost(
  snapshot: UiSessionSnapshot,
  organizationRole: string | undefined,
  isDemo: boolean,
): UiScopeHost | undefined {
  if (snapshot.scope.status === "loading") return void 0;
  return createUiScopeHost({
    project: () => snapshot.scope.project,
    organization: () => snapshot.scope.organization,
    team: () => snapshot.scope.team,
    organizationRole: () => organizationRole,
    hasPermission: snapshot.permissions.can,
    hasOrganizationPermission: snapshot.permissions.canInOrganization,
    isDemoProject: () => isDemo,
    isLoading: () => snapshot.permissions.isLoading,
  });
}
