/**
 * Who is here, what they may do, what is switched on — ALL THREE ANSWER
 * SYNCHRONOUSLY AND FAIL CLOSED: a permission that flickers open while
 * loading is a permission that leaked. Where they stand is scope's (§10.1).
 */

import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { useUiAddress } from "@langwatch/browser-host/address";
import type { UiActor, UiFeedback } from "@langwatch/browser-host/capabilities";
import { UiSession } from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";
import type {
  UiActiveScopeReading,
  UiSessionReading,
  UiSessionSnapshot,
} from "@langwatch/browser-host/session";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import {
  readUiActor,
  uiAuthClient,
  UI_SESSION_QUERY_KEY,
  type UiAuthClient,
  type UiSessionReading as UiSessionResponse,
} from "../session";
import {
  useUiEffectivePermissions,
  useUiFeatureFlags,
  type UiEffectivePermissionsRead,
  type UiFeatureApiTransport,
} from "./ui-session-queries";

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
} & (
  | { readonly snapshot: UiSessionSnapshot }
  | {
      readonly actor: UiActor | null;
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
 * Who is here, and nothing else — the first of the composition's four calls.
 * A refused read is told through `feedback` because nobody else sees it, and
 * a visitor whose read answered "nobody" is sent to sign in from here.
 */
export function useUiSessionReading({
  feedback,
  isPublicRoute,
  authClient,
}: {
  /** Where a refused session read is told, since nobody else sees it. */
  feedback: UiFeedback;
  /** Whether this address renders without a session — the scope capability reads it. */
  isPublicRoute: boolean;
  /** The deployment's own client unless a test answers with a recorded session. */
  authClient?: UiAuthClient;
}): UiSessionReading {
  const address = useUiAddress();

  const session = useQuery({
    queryKey: UI_SESSION_QUERY_KEY,
    queryFn: () => readUiActor(authClient ?? uiAuthClient()),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const actor = session.data?.actor ?? null;
  const failure = session.data?.failure ?? null;

  // Once, per failed read, rather than once per render: the query holds its
  // answer, so the effect only re-runs when a re-read failed again.
  useEffect(() => {
    if (!failure) return;
    feedback.failed({ error: failure, fallbackTitle: "Couldn't check your session" });
  }, [failure, feedback]);

  const departure = uiSignedOutDeparture({
    actor,
    isAnswered: session.isSuccess,
    isPublicRoute,
    isOnline: navigator.onLine,
    isApiUnreachable: session.data?.unreachable === true,
    address,
  });

  useEffect(() => {
    if (departure === null) return;
    uiLeaveTo(departure);
  }, [departure]);

  return readSession(session);
}

/**
 * Install with `createUiApplication({ features: { session: … } })`. Takes the
 * scope READING, never the scope port: the port's nulls read the same while
 * resolving as when genuinely unscoped, so a guard would open mid-resolution.
 */
export function useBrowserUiSession({
  transport,
  session,
  scope,
}: {
  transport: UiFeatureApiTransport;
  session: UiSessionReading;
  scope: UiActiveScopeReading;
}): BrowserUiSession {
  const [flagRequests] = useState(() => new UiFeatureFlagRequests());
  const userId = session.user?.id;
  const projectId = scope.project?.id;
  const organizationId = scope.organization?.id;

  const permissions = useUiEffectivePermissions({
    transport,
    projectId,
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
    projectId: projectId ?? null,
    organizationId: organizationId ?? null,
    // A flag read that leaves out a scope it should have named cannot match
    // the rule that names it, so nothing is asked until the scope has settled.
    enabled: scope.status !== "loading",
  });

  const askFlag = useCallback((flag: string) => flagRequests.ask(flag), [flagRequests]);

  const snapshot: UiSessionSnapshot = {
    session,
    scope,
    permissions: readPermissions(scope.status, permissions, organizationPermissions),
  };

  return BrowserUiSession.create({ snapshot, flags, askFlag });
}

function readSession(query: UseQueryResult<UiSessionResponse>): UiSessionReading {
  if (query.isLoading) return { status: "loading", user: null };
  if (query.data?.unreachable) return { status: "offline", user: null };
  if (query.isError || query.data?.failure) return { status: "error", user: null };
  const actor = query.data?.actor;
  if (actor) return { status: "authenticated", user: actor };
  return { status: "anonymous", user: null };
}

function readPermissions(
  scopeStatus: UiActiveScopeReading["status"],
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
  scopeStatus: UiActiveScopeReading["status"],
  project: UseQueryResult<UiEffectivePermissionsRead>,
  organization: UseQueryResult<UiEffectivePermissionsRead>,
): UiSessionSnapshot["permissions"]["status"] {
  if (scopeStatus !== "ready") return scopeStatus;
  if (project.isLoading || organization.isLoading) return "loading";
  if (project.isError || organization.isError) return "unavailable";
  return "ready";
}
