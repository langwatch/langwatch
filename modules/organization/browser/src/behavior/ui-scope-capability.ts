/**
 * Where the reader is standing, as the capability a composition installs:
 * the address bar, the organization graph and the device's memory. FAILS
 * CLOSED — nothing reads `ready` until the graph it resolved against landed.
 */

import { authzWebConfigSchema } from "@langwatch/authz-contract";
import { UiScope, type UiActiveScope, type UiSession } from "@langwatch/browser-host/capabilities";
import type {
  UiActiveScopeReading,
  UiPermissionsReading,
  UiSessionReading,
} from "@langwatch/browser-host/session";
import {
  createUiScopeHost,
  type UiScopeHost,
} from "@langwatch/browser-host/use-organization-team-project";
import {
  parsePublicAppConfigMetaContent,
  parsePublicConfigSlice,
  PUBLIC_APP_CONFIG_META_NAME,
} from "@langwatch/config/public-app-config";
import type { UiResolvedScope, UiScopeProject } from "@langwatch/organization-contract";
import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  useUiOrganizations,
  useUiSharedProject,
  type UiFeatureApiTransport,
} from "./ui-scope-queries";
import { resolveUiScope, uiScopeSelectionWrites } from "./ui-scope-resolution";
import { useUiRouteReading } from "./ui-scope-route";
import { rememberUiScopeSelection, useUiScopeMemory } from "./ui-scope-storage";

/**
 * What this render resolved: the reading every other capability may hold,
 * plus the two facts only the legacy scope host still asks for.
 */
export type UiScopeReading = {
  readonly scope: UiActiveScopeReading;
  /** The reader's role in the resolved organization, for the legacy host. */
  readonly organizationRole: string | undefined;
  /** Whether the address bar names the deployment's shared demo project. */
  readonly isDemo: boolean;
};

/**
 * The deployment's demo project slug, or nothing — never a crash. Reads
 * the HTML shell's meta tag directly (record 10.1 rules out an apps/ui
 * import here).
 */
export function readUiDemoProjectSlug(
  documentRoot: {
    querySelector(selector: string): { getAttribute(name: string): string | null } | null;
  } = document,
): string | undefined {
  const content = documentRoot
    .querySelector(`meta[name="${PUBLIC_APP_CONFIG_META_NAME}"]`)
    ?.getAttribute("content");
  if (!content) return void 0;
  try {
    return parsePublicConfigSlice({
      config: parsePublicAppConfigMetaContent(content),
      owner: "authz",
      schema: authzWebConfigSchema,
    }).demoProjectSlug;
  } catch {
    return void 0;
  }
}

/**
 * Resolves where this page is standing. Takes the session READING rather
 * than the session port: it needs the user id and nothing else auth holds.
 */
export function useUiScopeReading({
  transport,
  session,
}: {
  transport: UiFeatureApiTransport;
  session: UiSessionReading;
}): UiScopeReading {
  const route = useUiRouteReading();
  const memory = useUiScopeMemory();
  const [demoProjectSlug] = useState(readUiDemoProjectSlug);
  const userId = session.user?.id;

  // The demo project is addressed by the raw segment, reserved slugs included:
  // it is the URL naming the deployment's demo, not a project of the caller's.
  const isDemo = Boolean(demoProjectSlug && route.projectParam === demoProjectSlug);

  const organizations = useUiOrganizations({
    transport,
    isDemo,
    enabled: !!session.user || !route.isPublicRoute,
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
  const project = isSharedRoute ? sharedTrace.data?.project : resolved.project;

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

  return {
    scope: readActiveScope({
      session,
      source: isSharedRoute ? sharedTrace : organizations,
      resolved,
      project,
    }),
    organizationRole: resolved.organizationRole,
    isDemo,
  };
}

export type BrowserUiScopeState = {
  readonly reading: UiActiveScopeReading;
  readonly scopeHost: UiScopeHost | undefined;
};

/** The scope port over the same render's worth of answers. */
export class BrowserUiScope extends UiScope {
  static create(state: BrowserUiScopeState): BrowserUiScope {
    return new BrowserUiScope(state);
  }

  private constructor(private readonly state: BrowserUiScopeState) {
    super();
  }

  activeScope(): UiActiveScope {
    const { organization, project } = this.state.reading;
    return { organizationId: organization?.id ?? null, projectId: project?.id ?? null };
  }

  override scopeHost(): UiScopeHost | undefined {
    return this.state.scopeHost;
  }
}

/**
 * The scope port, built from what this render resolved and the grants the
 * session beside it answered. Pure — every read it needs has already landed.
 */
export function createBrowserUiScope({
  reading,
  session,
}: {
  reading: UiScopeReading;
  session: UiSession;
}): BrowserUiScope {
  return BrowserUiScope.create({
    reading: reading.scope,
    scopeHost: legacyScopeHost({ reading, permissions: session.snapshot().permissions }),
  });
}

function readActiveScope({
  session,
  source,
  resolved,
  project,
}: {
  session: UiSessionReading;
  source: UseQueryResult<unknown>;
  resolved: UiResolvedScope;
  project: UiScopeProject | undefined;
}): UiActiveScopeReading {
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

function legacyScopeHost({
  reading,
  permissions,
}: {
  reading: UiScopeReading;
  permissions: UiPermissionsReading;
}): UiScopeHost | undefined {
  if (reading.scope.status === "loading") return void 0;
  return createUiScopeHost({
    project: () => reading.scope.project,
    organization: () => reading.scope.organization,
    team: () => reading.scope.team,
    organizationRole: () => reading.organizationRole,
    hasPermission: permissions.can,
    hasOrganizationPermission: permissions.canInOrganization,
    isDemoProject: () => reading.isDemo,
    isLoading: () => permissions.isLoading,
  });
}
