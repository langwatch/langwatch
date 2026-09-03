/**
 * The session capability: who is here, what scope, what they may do, what
 * is switched on. All FOUR ANSWER SYNCHRONOUSLY AND FAIL CLOSED — a
 * permission that flickers open while loading is a permission that leaked.
 */

import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UiActiveScope, UiActor, UiFeedbackPort } from "./ui-capabilities";
import { UiSessionPort } from "./ui-capabilities";
import { useUiAddress } from "./ui-address";
import { uiLeaveTo } from "./ui-departure";
import type { UiFeatureApiTransport } from "./ui-feature-transport";
import { readPublicAppConfig } from "./public-config";
import { resolveUiScope, uiScopeSelectionWrites } from "./ui-scope-resolution";
import { useUiRouteReading } from "./ui-scope-route";
import { broadcastUiScopeWrite, useUiScopeMemory, writeUiScopeSelection } from "./ui-scope-storage";
import {
  readUiActor,
  uiAuthClient,
  UI_SESSION_QUERY_KEY,
  type UiAuthClient,
} from "./ui-session-client";
import {
  useUiEffectivePermissions,
  useUiFeatureFlags,
  useUiOrganizations,
  useUiSharedProject,
} from "./ui-session-queries";

/**
 * A composition's live session, built where the transport is — declared
 * as a source (a hook, called once) rather than a port, since the answer
 * changes as the reader navigates and the reads land.
 */
export type UiSessionSource = (input: {
  transport: UiFeatureApiTransport;
  /** Where a refused session read is told, since nobody else sees it. */
  feedback: UiFeedbackPort;
}) => UiSessionPort;

/** The screen a visitor with no session is sent to. */
export const UI_SIGN_IN_PATH = "/auth/signin";

/**
 * Where a visitor goes once the session read has answered — null means stay.
 *
 * Carried over from `platform/app`'s `useRequiredSession`: the sign-in screen,
 * never onboarding, and the address they asked for rides along as the
 * callback. A public route needs no session, and an offline browser cannot
 * load the sign-in screen either, so both stay put.
 */
export function uiSignedOutDeparture({
  actor,
  isAnswered,
  isPublicRoute,
  isOnline,
  address,
}: {
  actor: UiActor | null;
  isAnswered: boolean;
  isPublicRoute: boolean;
  isOnline: boolean;
  address: string;
}): string | null {
  if (!isAnswered || actor !== null || isPublicRoute || !isOnline) return null;
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
  readonly actor: UiActor | null;
  readonly scope: UiActiveScope;
  /** Undefined until the server has answered for this scope. */
  readonly permissions: ReadonlySet<string> | undefined;
  /** Whether the scope and its permissions have both answered. */
  readonly settled: boolean;
  readonly flags: ReadonlyMap<string, boolean>;
  readonly askFlag: (flag: string) => void;
};

/** The port over one render's worth of answers. */
export class BrowserUiSession extends UiSessionPort {
  static create(state: BrowserUiSessionState): BrowserUiSession {
    return new BrowserUiSession(state);
  }

  private constructor(private readonly state: BrowserUiSessionState) {
    super();
  }

  currentUser(): UiActor | null {
    return this.state.actor;
  }

  activeScope(): UiActiveScope {
    return this.state.scope;
  }

  /**
   * Whether the caller holds a permission — applies the one hierarchy
   * rule the engine applies (`<resource>:manage` satisfies narrower
   * actions) through the engine's own helper, so the two can't drift.
   */
  hasPermission(permission: string): boolean {
    const granted = this.state.permissions;
    if (!granted) return false;
    return permissionSatisfiedBy({ granted, requested: permission });
  }

  isSettled(): boolean {
    return this.state.settled;
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
  feedback: UiFeedbackPort;
  /** The deployment's own client unless a test answers with a recorded session. */
  authClient?: UiAuthClient;
}): UiSessionPort {
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
  const sharedProject = sharedTrace.data?.project;
  const project = sharedProject ?? resolved.project;
  const organizationId = resolved.organization?.id;

  const permissions = useUiEffectivePermissions({
    transport,
    projectId: project?.id,
    organizationId,
  });

  // Built once per fetched set rather than once per `hasPermission` call: a
  // page asking about a dozen permissions on every render would otherwise
  // rebuild the same set a dozen times a render.
  const granted = useMemo(
    () => (permissions.data ? new Set(permissions.data.permissions) : void 0),
    [permissions.data],
  );

  // Settled means "the answers are the server's, not the fail-closed default".
  // A caller with no scope at all has nothing to ask about, and waiting for an
  // answer that will never be requested would leave a guard loading forever.
  const settled =
    !organizations.isLoading && (granted !== void 0 || (!project?.id && !organizationId));

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
    writeUiScopeSelection({
      writes,
      storage: window.localStorage,
      broadcast: broadcastUiScopeWrite,
    });
  }, [writes]);

  const askFlag = useCallback((flag: string) => flagRequests.ask(flag), [flagRequests]);

  return useMemo(
    () =>
      BrowserUiSession.create({
        actor,
        scope: {
          organizationId: organizationId ?? null,
          projectId: project?.id ?? null,
        },
        permissions: granted,
        settled,
        flags,
        askFlag,
      }),
    [actor, organizationId, project?.id, granted, settled, flags, askFlag],
  );
}
