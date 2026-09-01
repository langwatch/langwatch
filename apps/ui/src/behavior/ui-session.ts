/**
 * The session capability, assembled.
 *
 * Four questions a screen may ask — who is here, what scope this page is
 * about, what they may do, and what is switched on — answered from four reads
 * and the harvested scope resolution. All four answer SYNCHRONOUSLY and fail
 * closed, so a screen renders the same way while an answer is loading as it
 * does when the answer is no: a permission that flickers open is a permission
 * that leaked.
 *
 * The three expensive answers are resolved once per scope, never per call.
 * `hasPermission` reads a set built once per fetched permission list; a page
 * asking about a dozen permissions on every render rebuilds nothing and fires
 * nothing. `isFeatureEnabled` cannot know in advance which flags a screen will
 * ask about, so the first ask registers the flag and answers false; the read
 * that follows answers for every later render.
 */

import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UiActiveScope, UiActor } from "./ui-capabilities";
import { UiSessionPort } from "./ui-capabilities";
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
 * A composition's live session, built where the transport is.
 *
 * Declared as a source rather than a port because the answer changes as the
 * reader navigates and the reads land: it is a hook, called once inside the
 * shell, and what it returns is the port for that render.
 */
export type UiSessionSource = (input: { transport: UiFeatureApiTransport }) => UiSessionPort;

/**
 * The deployment's demo project slug, or nothing.
 *
 * Absent config means no demo project, never a crash: the application reads
 * the same fact from a query that is simply undefined until it answers, and a
 * composition whose HTML shell carries no config is a composition with no demo
 * project rather than a broken one.
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
 * The flags screens have asked about, in ask order.
 *
 * A screen names its flag while it renders, and a read cannot start there:
 * React refuses a state update from inside another component's render, and it
 * would be a fresh render pass per flag anyway. The ask is recorded and
 * broadcast on the microtask queue instead, so the render that asked finishes
 * with `false` and the next one has the read in flight.
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
   * Whether the caller holds a permission in the active scope.
   *
   * The server answers with the granted set and the browser applies the one
   * hierarchy rule the engine applies — `<resource>:manage` satisfies the
   * narrower actions on the same resource — through the engine's own helper,
   * so the two can never drift into disagreeing.
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
 * The session capability of the document this application is running in.
 *
 * Install it with `createUiApplication({ features: { session:
 * useBrowserUiSession } })`. A composition that installs nothing keeps the
 * refusing default, which is the right answer for one that has no host to ask.
 */
export function useBrowserUiSession({
  transport,
  authClient,
}: {
  transport: UiFeatureApiTransport;
  /** The deployment's own client unless a test answers with a recorded session. */
  authClient?: UiAuthClient;
}): UiSessionPort {
  const route = useUiRouteReading();
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
  const actor = session.data ?? null;
  const userId = actor?.id;

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
        projectParam: route.projectParam,
        lastVisitedHomeKind: memory.lastVisitedHomeKind,
      }),
    [resolved, memory, route.projectParam],
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
