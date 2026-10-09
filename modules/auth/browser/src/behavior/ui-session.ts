/**
 * Who is here and what they may do — BOTH ANSWER
 * SYNCHRONOUSLY AND FAIL CLOSED: a permission that flickers open while
 * loading is a permission that leaked. Where they stand is scope's (§10.1).
 */

import type { UiAuthClient } from "@langwatch/auth-contract";
import { permissionSatisfiedBy } from "@langwatch/authorization";
import { useUiAddress } from "@langwatch/browser-host/address";
import type { UiActor, UiFeedback } from "@langwatch/browser-host/capabilities";
import { UiSession } from "@langwatch/browser-host/capabilities";
import { uiLeaveTo } from "@langwatch/browser-host/navigation";
import type {
  UiActiveScopeReading,
  UiSessionReading,
  UiSessionSnapshot,
} from "@langwatch/browser-host/session";
import { setUiStorageReader } from "@langwatch/browser-host/storage";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useLayoutEffect } from "react";

import { refusedOnAggregate } from "../model/refused-on-aggregate.ts";
import {
  readUiActor,
  uiAuthClient,
  UI_SESSION_QUERY_KEY,
  type UiSessionReading as UiSessionResponse,
} from "./ui-session-client";
import {
  useUiEffectivePermissions,
  type UiEffectivePermissionsRead,
  type UiFeatureApiTransport,
} from "./ui-session-queries";
import { useRefreshUiSession } from "./ui-session-refresh";

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

export type BrowserUiSessionState = {
  /** Absent where nothing can re-read the session, as in a recorded test. */
  readonly refresh?: () => Promise<void>;
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

  /** The active scope's one grant read answers, as on main (scope knot Q2). */
  override hasOrganizationPermission(permission: string): boolean {
    if ("snapshot" in this.state) {
      return this.state.snapshot.permissions.canInOrganization(permission);
    }
    return super.hasOrganizationPermission(permission);
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

  override refresh(): Promise<void> {
    if (!this.state.refresh) return super.refresh();
    return this.state.refresh();
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
  const isAnswered = session.isSuccess && session.data.unreachable !== true;

  // Remembered preferences are the answered reader's own; before paint, so none flash.
  useLayoutEffect(() => {
    if (isAnswered) setUiStorageReader(actor?.id);
  }, [isAnswered, actor?.id]);

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
  isPublicRoute,
}: {
  transport: UiFeatureApiTransport;
  session: UiSessionReading;
  scope: UiActiveScopeReading;
  /** The address renders without a session: no grant is read, none is held. */
  isPublicRoute: boolean;
}): BrowserUiSession {
  const userId = session.user?.id;
  const projectId = scope.project?.id;
  const organizationId = scope.organization?.id;

  const permissions = useUiEffectivePermissions({
    transport,
    projectId,
    organizationId,
    userId,
    isPublicRoute,
  });

  const refresh = useRefreshUiSession();

  const snapshot: UiSessionSnapshot = {
    session,
    scope,
    permissions: isPublicRoute
      ? NO_PERMISSIONS_ON_A_PUBLIC_PAGE
      : readPermissions(scope, permissions),
  };

  return BrowserUiSession.create({ snapshot, refresh });
}

/**
 * A public page (the shared trace) holds no permission, signed in or not, as on
 * main: a cached grant for the shared project must not answer there either.
 */
const NO_PERMISSIONS_ON_A_PUBLIC_PAGE: UiSessionSnapshot["permissions"] = {
  status: "ready",
  isLoading: false,
  can: () => false,
  canInOrganization: () => false,
};

function readSession(query: UseQueryResult<UiSessionResponse>): UiSessionReading {
  if (query.isLoading) return { status: "loading", user: null };
  if (query.data?.unreachable) return { status: "offline", user: null };
  if (query.isError || query.data?.failure) return { status: "error", user: null };
  const actor = query.data?.actor;
  if (actor) return { status: "authenticated", user: actor };
  return { status: "anonymous", user: null };
}

/**
 * One grant read answers both, as on main: organization permissions follow it (scope knot Q2).
 * The server refuses every write under an aggregate project whatever the role (ADR-175
 * decision 8), so the session refuses the same writes there and no control offers one.
 */
function readPermissions(
  scope: UiActiveScopeReading,
  grantRead: UseQueryResult<UiEffectivePermissionsRead>,
): UiSessionSnapshot["permissions"] {
  const status = permissionStatus(scope.status, grantRead);
  const grants = new Set(grantRead.isError ? [] : grantRead.data?.permissions);
  const onAggregate = isAggregateProjectKind(scope.project?.kind);
  const can = (requested: string) =>
    scope.status === "ready" &&
    !(onAggregate && refusedOnAggregate(requested)) &&
    permissionSatisfiedBy({ granted: grants, requested });
  return { status, isLoading: status === "loading", can, canInOrganization: can };
}

function permissionStatus(
  scopeStatus: UiActiveScopeReading["status"],
  grantRead: UseQueryResult<UiEffectivePermissionsRead>,
): UiSessionSnapshot["permissions"]["status"] {
  if (scopeStatus !== "ready") return scopeStatus;
  if (grantRead.isLoading) return "loading";
  if (grantRead.isError) return "unavailable";
  return "ready";
}
