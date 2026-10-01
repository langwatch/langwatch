/**
 * Trace's answer to the port its screens declare: every method projects a
 * `@langwatch/browser-host` capability, so the module mounts it, not the
 * application. ARCHITECTURE.md §10.1.
 */

import { useUiCapabilities } from "@langwatch/browser-host/capabilities";
import { useEffect, useMemo, type ReactNode } from "react";

import { traceApi } from "./trace-api.ts";
import {
  TraceHostApi,
  TraceHostProvider,
  type TraceFailureNotice,
  type TraceHostOrganization,
  type TraceHostOrganizationRole,
  type TraceHostProject,
  type TraceHostTeam,
  type TraceHostUser,
  type TraceRouteReading,
  type TraceSuccessNotice,
} from "./trace-host.ts";

type TraceHostReadings = {
  readonly project: TraceHostProject | undefined;
  readonly organization: TraceHostOrganization | undefined;
  readonly team: TraceHostTeam | undefined;
  readonly currentUser: TraceHostUser | undefined;
  readonly isLoading: boolean;
};

type TraceHostActions = {
  readonly hasPermission: (permission: string) => boolean;
  readonly route: () => TraceRouteReading;
  readonly setQuery: (
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  readonly navigate: (to: string, options?: { replace?: boolean }) => void;
  readonly succeeded: (notice: TraceSuccessNotice) => void;
  readonly failed: (failure: TraceFailureNotice) => void;
};

class CapabilityTraceHost extends TraceHostApi {
  constructor(
    private readonly readings: TraceHostReadings,
    private readonly actions: TraceHostActions,
  ) {
    super();
  }

  project(): TraceHostProject | undefined {
    return this.readings.project;
  }

  organization(): TraceHostOrganization | undefined {
    return this.readings.organization;
  }

  team(): TraceHostTeam | undefined {
    return this.readings.team;
  }

  /**
   * No capability carries the reader's standing in the organization yet. The
   * port admits absence, so absence is what it is told — never a guessed role.
   */
  organizationRole(): TraceHostOrganizationRole {
    return void 0;
  }

  currentUser(): TraceHostUser | undefined {
    return this.readings.currentUser;
  }

  hasPermission(permission: string): boolean {
    return this.actions.hasPermission(permission);
  }

  isLoading(): boolean {
    return this.readings.isLoading;
  }

  route(): TraceRouteReading {
    return this.actions.route();
  }

  setQuery(
    next: Readonly<Record<string, string | undefined>>,
    options?: { replace?: boolean },
  ): void {
    this.actions.setQuery(next, options);
  }

  navigate(to: string, options?: { replace?: boolean }): void {
    this.actions.navigate(to, options);
  }

  succeeded(notice: TraceSuccessNotice): void {
    this.actions.succeeded(notice);
  }

  failed(failure: TraceFailureNotice): void {
    this.actions.failed(failure);
  }

  /**
   * No `@langwatch/browser-host` capability carries the agent's page
   * registry, so the port is told absence rather than a guess: a composition
   * that installs Langy answers this from Langy's published capability.
   */
  registerLangyActions(): () => void {
    return () => void 0;
  }

  /** Likewise the ask: no capability carries the agent's composer yet. */
  askLangy(): void {
    // Nothing to hand it to.
  }
}

type ProjectRecord = {
  apiKey: string | undefined;
  firstMessage: boolean | undefined;
  presenceEnabled: boolean | undefined;
  organizationPresenceEnabled: boolean | undefined;
};

const NO_RECORD: ProjectRecord = {
  apiKey: void 0,
  firstMessage: void 0,
  presenceEnabled: void 0,
  organizationPresenceEnabled: void 0,
};

/**
 * What the session scope does not carry, off the project's `organization.getAll`
 * row: the legacy base key (blanked for a reader who may not manage the project),
 * the first-trace flag and the presence switches. The shared-trace page asks nothing.
 */
function useProjectRecord(input: {
  projectId: string | undefined;
  enabled: boolean;
}): ProjectRecord {
  const graph = traceApi.organization.getAll.useQuery(
    { isDemo: false },
    { enabled: input.enabled && input.projectId !== void 0 },
  );
  if (!input.projectId) return NO_RECORD;
  for (const organization of graph.data ?? []) {
    for (const team of organization.teams) {
      const project = team.projects.find((candidate) => candidate.id === input.projectId);
      if (project) {
        return {
          apiKey: project.apiKey || void 0,
          firstMessage: project.firstMessage,
          presenceEnabled: project.presenceEnabled,
          organizationPresenceEnabled: organization.presenceEnabled,
        };
      }
    }
  }
  return NO_RECORD;
}

const FIRST_TRACE_POLL_MS = 5_000;

/** Self-stopping poll interval: re-read until the project has its first trace. */
export function firstTracePollInterval(
  data: { firstMessage: boolean } | undefined,
): number | false {
  return data?.firstMessage ? false : FIRST_TRACE_POLL_MS;
}

/**
 * The organization graph is re-read only on focus or a route change, so while
 * the flag is false this polls the small first-trace read. When it flips, the
 * explorer follows at once and the graph is refreshed for every other reader.
 */
function useFirstMessage(input: {
  projectId: string | undefined;
  recorded: boolean | undefined;
}): boolean | undefined {
  const utils = traceApi.useUtils();
  const waiting = input.projectId !== void 0 && input.recorded === false;
  const firstTrace = traceApi.project.getHasFirstMessage.useQuery(
    { projectId: input.projectId ?? "" },
    {
      enabled: waiting,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => firstTracePollInterval(query.state.data),
    },
  );
  const arrived = waiting && firstTrace.data?.firstMessage === true;

  useEffect(() => {
    if (!arrived) return;
    void utils.organization.getAll.invalidate();
  }, [arrived, utils]);

  return arrived ? true : input.recorded;
}

function projectReading(input: {
  id: string | undefined;
  slug: string | undefined;
  name: string | undefined;
  apiKey: string | undefined;
  firstMessage: boolean | undefined;
  presenceEnabled: boolean | undefined;
}): TraceHostProject | undefined {
  if (input.id === void 0) return void 0;
  const { apiKey, firstMessage, presenceEnabled } = input;
  return {
    id: input.id,
    slug: input.slug ?? "",
    name: input.name ?? "",
    ...(apiKey ? { apiKey } : {}),
    ...(firstMessage === void 0 ? {} : { firstMessage }),
    ...(presenceEnabled === void 0 ? {} : { presenceEnabled }),
  };
}

function organizationReading(input: {
  id: string | undefined;
  name: string | undefined;
  presenceEnabled: boolean | undefined;
}): TraceHostOrganization | undefined {
  if (input.id === void 0) return void 0;
  const { name, presenceEnabled } = input;
  return {
    id: input.id,
    ...(name ? { name } : {}),
    ...(presenceEnabled === void 0 ? {} : { presenceEnabled }),
  };
}

/**
 * The mount the declaration names: one provider above the routed tree, so a
 * peer's screen reading this port finds it too. Default-exported because that
 * is what `mounts.load` resolves.
 */
export default function TraceHostMount({ children }: { children?: ReactNode }) {
  const { session, navigation, route, feedback } = useUiCapabilities();
  const { organization, team, project, status } = session.snapshot().scope;
  const actor = session.currentUser();

  // Primitive dependencies only, so the host stays the SAME object across
  // renders carrying the same reading: `lazy()` resolved this mount once, and
  // a fresh object every render would remount the whole tree under it.
  const projectId = project?.id;
  const projectName = project?.name;
  const projectSlug = project?.slug;
  const organizationId = organization?.id;
  const organizationName = organization?.name;
  const teamId = team?.id;
  const teamName = team?.name;
  const actorId = actor?.id;
  const actorName = actor?.name;
  const actorEmail = actor?.email;
  const actorImage = actor?.image;
  const record = useProjectRecord({ projectId, enabled: actorId !== void 0 });
  const { apiKey, presenceEnabled, organizationPresenceEnabled } = record;
  const firstMessage = useFirstMessage({ projectId, recorded: record.firstMessage });

  const host = useMemo(
    () =>
      new CapabilityTraceHost(
        {
          project: projectReading({
            id: projectId,
            slug: projectSlug,
            name: projectName,
            apiKey,
            firstMessage,
            presenceEnabled,
          }),
          organization: organizationReading({
            id: organizationId,
            name: organizationName,
            presenceEnabled: organizationPresenceEnabled,
          }),
          team:
            teamId === void 0 ? void 0 : { id: teamId, ...(teamName ? { name: teamName } : {}) },
          currentUser:
            actorId === void 0
              ? void 0
              : { id: actorId, name: actorName, email: actorEmail, image: actorImage },
          isLoading: status === "loading",
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          route: () => {
            const reading = route.reading();
            return {
              params: reading.params,
              query: reading.query,
              pathname: reading.pathname ?? "",
            };
          },
          setQuery: (next, options) => route.setQuery(next, options),
          navigate: (to, options) =>
            options?.replace === true ? navigation.replace(to) : navigation.navigate(to),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [
      projectId,
      projectName,
      projectSlug,
      apiKey,
      firstMessage,
      presenceEnabled,
      organizationPresenceEnabled,
      organizationId,
      organizationName,
      teamId,
      teamName,
      actorId,
      actorName,
      actorEmail,
      actorImage,
      status,
      session,
      navigation,
      route,
      feedback,
    ],
  );

  return <TraceHostProvider value={host}>{children}</TraceHostProvider>;
}
