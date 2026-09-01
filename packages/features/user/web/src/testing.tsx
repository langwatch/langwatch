/**
 * The application a personal-workspace screen is mounted in, faked.
 *
 * Every screen in this package reads the world through
 * `PersonalWorkspaceHostPort`: who is here, what they may do, which flags are
 * on, which organization and project the address is about, and where a success
 * or a failure is announced. A test that mounts a screen therefore has to
 * answer that port, and answering it ad hoc per file is how a dozen suites come
 * to disagree about what a viewer is.
 *
 * Two things live here. `fakePersonalWorkspaceHost` builds the port from a
 * small configuration and records everything written through it, so an
 * assertion about a navigation or a toast reads off `host.recording` rather
 * than off a spy on a module. `renderWithPersonalWorkspaceHost` mounts a tree
 * underneath it and owns the one piece of state a static double cannot have:
 * the query string. The settings screen keeps its open tab in `?tab=`, so a
 * click that writes the address has to come back as a re-render.
 *
 * The coding-agent bridge is mounted too, because a screen that lists sessions
 * renders a table from `@langwatch/coding-agent-web` and that table asks its
 * own port. Mounting it here rather than per test is what keeps a screen test
 * from having to know the table has a port at all.
 *
 * Permissions resolve through `permissionSatisfiedBy`, the authz contract's own
 * hierarchy rule, rather than through a set-membership check written here — the
 * same choice `@langwatch/gateway-web`'s harness makes, and for the same
 * reason: a test that passes against this double cannot pass by disagreeing
 * with the rule the server applies.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import {
  PersonalWorkspaceHostPort,
  PersonalWorkspaceHostProvider,
  type PersonalActor,
  type PersonalDeployment,
  type PersonalFailureNotice,
  type PersonalOrganization,
  type PersonalOrganizationRole,
  type PersonalProject,
  type PersonalRouteReading,
  type PersonalScope,
  type PersonalSuccessNotice,
} from "./model/personal-workspace-host";
import { CodingAgentHostBridge } from "./ui/sections/coding-agent-host-provider";

export type PersonalQuery = Readonly<Record<string, string | undefined>>;

/** Everything a screen wrote through the host, in the order it wrote it. */
export type PersonalHostRecording = {
  navigations: string[];
  /** How many times a screen asked for the signed-in reader to be re-read. */
  sessionRefreshes: number;
  queries: Array<{ next: PersonalQuery; replace: boolean }>;
  successes: PersonalSuccessNotice[];
  failures: PersonalFailureNotice[];
};

/**
 * The organization the personal workspace is inside, unless a test says
 * otherwise. The same row the platform suites handed
 * `useOrganizationTeamProject`.
 */
export const FAKE_ORGANIZATION: PersonalOrganization = {
  id: "org-1",
  name: "ACME",
  slug: "acme",
  teams: [
    {
      id: "team-1",
      name: "Platform",
      projects: [{ id: "proj-1", name: "Web App", slug: "web-app", teamId: "team-1" }],
    },
  ],
};

export const FAKE_ACTOR: PersonalActor = {
  id: "user-1",
  name: "Carol",
  email: "carol@acme.example",
  image: null,
};

const DEFAULT_DEPLOYMENT: PersonalDeployment = {
  isSaas: true,
  appBaseUrl: "https://app.langwatch.ai",
};

export type FakePersonalHostOptions = {
  /** The grants the viewer holds, read through the authz hierarchy rule. */
  permissions?: readonly string[];
  /**
   * The frontend flags that are on. `"all"` is the default because the platform
   * suites mocked `useFeatureFlag` to answer yes; name a list when the flag
   * itself is what a test is about.
   */
  enabledFlags?: readonly string[] | "all";
  /** `null` means the scope has not resolved, which several screens gate on. */
  organization?: PersonalOrganization | null;
  /** `null` means no project is in scope, which the project screens gate on. */
  project?: PersonalProject | null;
  /** False is the "we have not looked yet" state the project screens hold. */
  isScopeResolved?: boolean;
  currentUser?: PersonalActor | null;
  /** `"EXTERNAL"` is what makes a viewer a lite member. */
  organizationRole?: PersonalOrganizationRole;
  deployment?: PersonalDeployment;
  /** Path parameters the screen was opened with, for example `{ project: "web-app" }`. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the screen opens on. */
  query?: PersonalQuery;
};

export class FakePersonalWorkspaceHost extends PersonalWorkspaceHostPort {
  static create(options: FakePersonalHostOptions = {}): FakePersonalWorkspaceHost {
    return new FakePersonalWorkspaceHost({
      options,
      recording: {
        navigations: [],
        sessionRefreshes: 0,
        queries: [],
        successes: [],
        failures: [],
      },
      query: options.query ?? {},
    });
  }

  /** Shared with every host derived from this one, so one read sees them all. */
  readonly recording: PersonalHostRecording;
  readonly query: PersonalQuery;

  private readonly options: FakePersonalHostOptions;
  private readonly granted: ReadonlySet<string>;
  private readonly commitQuery: ((next: PersonalQuery) => void) | undefined;
  private readonly routeReading: PersonalRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakePersonalHostOptions;
    recording: PersonalHostRecording;
    query: PersonalQuery;
    commitQuery?: (next: PersonalQuery) => void;
  }) {
    super();
    this.options = options;
    this.recording = recording;
    this.query = query;
    this.commitQuery = commitQuery;
    this.granted = new Set(options.permissions ?? []);
    this.routeReading = { params: options.params ?? {}, query };
  }

  /** The same host reading a different query, and able to write one back. */
  withQuery({
    query,
    commitQuery,
  }: {
    query: PersonalQuery;
    commitQuery: (next: PersonalQuery) => void;
  }): FakePersonalWorkspaceHost {
    return new FakePersonalWorkspaceHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  scope(): PersonalScope {
    return {
      organizationId: this.organization()?.id ?? null,
      projectId: this.project()?.id ?? null,
    };
  }

  organization(): PersonalOrganization | undefined {
    const configured = this.options.organization;
    if (configured === void 0) return FAKE_ORGANIZATION;
    return configured ?? void 0;
  }

  project(): PersonalProject | undefined {
    const configured = this.options.project;
    if (configured === void 0) return this.organization()?.teams[0]?.projects[0];
    return configured ?? void 0;
  }

  isScopeResolved(): boolean {
    return this.options.isScopeResolved ?? true;
  }

  currentUser(): PersonalActor | null {
    const configured = this.options.currentUser;
    return configured === void 0 ? FAKE_ACTOR : configured;
  }

  organizationRole(): PersonalOrganizationRole {
    return this.options.organizationRole;
  }

  hasPermission(permission: string): boolean {
    return permissionSatisfiedBy({ granted: this.granted, requested: permission });
  }

  isFeatureEnabled(flag: string): boolean {
    const flags = this.options.enabledFlags ?? "all";
    return flags === "all" || flags.includes(flag);
  }

  deployment(): PersonalDeployment {
    return this.options.deployment ?? DEFAULT_DEPLOYMENT;
  }

  route(): PersonalRouteReading {
    return this.routeReading;
  }

  setQuery(next: PersonalQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  async refreshSession(): Promise<void> {
    this.recording.sessionRefreshes += 1;
  }

  succeeded(notice: PersonalSuccessNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: PersonalFailureNotice): void {
    this.recording.failures.push(failure);
  }
}

export function fakePersonalWorkspaceHost(
  options: FakePersonalHostOptions = {},
): FakePersonalWorkspaceHost {
  return FakePersonalWorkspaceHost.create(options);
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key removed —
 * which is the contract the port states and the one the settings screen relies
 * on to drop `?tab=` when the reader goes back to the default tab.
 */
function PersonalHostHarness({
  host,
  children,
}: {
  host: FakePersonalWorkspaceHost;
  children: ReactNode;
}) {
  const [query, setQuery] = useState<PersonalQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return (
    <PersonalWorkspaceHostProvider value={live}>
      <CodingAgentHostBridge>{children}</CodingAgentHostBridge>
    </PersonalWorkspaceHostProvider>
  );
}

/**
 * The tree a screen is mounted inside, as a Testing Library wrapper.
 *
 * A wrapper rather than a wrapped element, so `rerender` keeps the host and the
 * query state: Testing Library re-applies the wrapper on every re-render.
 */
export function personalWorkspaceHostWrapper(host: FakePersonalWorkspaceHost) {
  return ({ children }: { children: ReactNode }) => (
    <ChakraProvider value={defaultSystem}>
      <PersonalHostHarness host={host}>{children}</PersonalHostHarness>
    </ChakraProvider>
  );
}

/** Mounts a personal-workspace screen the way its frontend feature mounts it. */
export function renderWithPersonalWorkspaceHost(
  element: ReactElement,
  { host }: { host: FakePersonalWorkspaceHost },
): RenderResult {
  return render(element, { wrapper: personalWorkspaceHostWrapper(host) });
}
