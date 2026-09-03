/**
 * The application an automations surface is mounted in, faked.
 *
 * Every screen, drawer and delivery provider in this package reads the world
 * through `AutomationHostPort`: which project the page is about, what the
 * reader may do, which flags are on, what the address says, and where a success
 * or a failure is announced. A test that mounts one therefore has to answer
 * that port, and answering it ad hoc per file is how a dozen suites come to
 * disagree about what a viewer is.
 *
 * Two things live here. `fakeAutomationHost` builds the port from a small
 * configuration and records everything written through it, so an assertion
 * about a navigation or a toast reads off `host.recording` rather than off a
 * spy on a module. `renderWithAutomationHost` mounts a tree underneath it and
 * owns the one piece of state a static double cannot have: the query string.
 * The surfaces read their own address back — a filtered table, a selected tab —
 * so a write has to come back as a re-render or the test proves nothing.
 *
 * The two automation editors are NOT among them any more. They open through the
 * drawer registry, which the composing application mounts above every page, so
 * what this double answers for them is `openDrawer`: it records which overlay
 * was asked for, and the address that carries the request is the application's
 * to spell.
 *
 * Permissions resolve through `permissionSatisfiedBy`, the authz contract's own
 * hierarchy rule (`<resource>:manage` satisfies `<resource>:view` on the same
 * resource), rather than through a set-membership check written here. A test
 * that passes against this double therefore cannot pass by disagreeing with the
 * rule the server applies.
 *
 * The same shape as `@langwatch/gateway-web`'s harness, because the two host
 * ports are the same shape. They converge when the ports are promoted.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { AutomationToast, AutomationToaster } from "./behavior/automation-feedback";
import {
  AutomationHostPort,
  AutomationHostProvider,
  type AutomationDrawer,
  type AutomationFailureNotice,
  type AutomationOrganization,
  type AutomationProject,
  type AutomationRouteReading,
  type AutomationScope,
  type AutomationSuccessNotice,
  type AutomationTeam,
} from "./model/automation-host";

export type AutomationQuery = Readonly<Record<string, string | undefined>>;

/** One overlay a surface asked the application to open. */
export type RecordedAutomationDrawerOpen = {
  drawer: AutomationDrawer;
  params: Readonly<Record<string, string | undefined>>;
};

/** Everything a surface wrote through the host, in the order it wrote it. */
export type AutomationHostRecording = {
  navigations: string[];
  queries: Array<{ next: AutomationQuery; replace: boolean }>;
  /**
   * RECORDED RATHER THAN SPELLED. The `drawer.` vocabulary is the composing
   * application's — its adapter writes `?drawer.open=<name>` plus one
   * `drawer.<key>` per parameter, and its own suite pins that. What this
   * package can state, and all it should, is WHICH overlay a click asked for
   * and with what. The shape the model-provider family's double already takes.
   */
  drawerOpens: RecordedAutomationDrawerOpen[];
  successes: AutomationSuccessNotice[];
  failures: AutomationFailureNotice[];
};

export const FAKE_ORGANIZATION: AutomationOrganization = {
  id: "org-1",
  name: "ACME",
  slug: "acme",
};

export const FAKE_TEAM: AutomationTeam = { id: "team-1", name: "Platform", slug: "platform" };

export const FAKE_PROJECT: AutomationProject = {
  id: "proj-1",
  name: "Web App",
  slug: "web-app",
};

export type FakeAutomationHostOptions = {
  /** The grants the viewer holds, read through the authz hierarchy rule. */
  permissions?: readonly string[];
  /**
   * The frontend flags that are on. `"all"` is the default because the platform
   * suites mocked `useFeatureFlag` to answer yes; name a list when the flag
   * itself is what a test is about, and `"pending"` when the point is that the
   * answer has not arrived.
   */
  enabledFlags?: readonly string[] | "all" | "pending";
  /** `null` means the scope has not resolved, which several surfaces gate on. */
  organization?: AutomationOrganization | null;
  team?: AutomationTeam | null;
  project?: AutomationProject | null;
  appBaseUrl?: string;
  /** Path parameters the screen was opened with, for example `{ project: "web-app" }`. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the screen opens on. */
  query?: AutomationQuery;
};

const DEFAULT_APP_BASE_URL = "https://app.langwatch.ai";

export class FakeAutomationHost extends AutomationHostPort {
  static create(options: FakeAutomationHostOptions = {}): FakeAutomationHost {
    return new FakeAutomationHost({
      options,
      recording: {
        navigations: [],
        queries: [],
        drawerOpens: [],
        successes: [],
        failures: [],
      },
      query: options.query ?? {},
    });
  }

  /** Shared with every host derived from this one, so one read sees them all. */
  readonly recording: AutomationHostRecording;
  readonly query: AutomationQuery;

  private readonly options: FakeAutomationHostOptions;
  private readonly granted: ReadonlySet<string>;
  private readonly commitQuery: ((next: AutomationQuery) => void) | undefined;
  /**
   * Built once per instance rather than per call: the surfaces memoize on the
   * reading, and a fresh object every render would rebuild everything derived
   * from it.
   */
  private readonly routeReading: AutomationRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakeAutomationHostOptions;
    recording: AutomationHostRecording;
    query: AutomationQuery;
    commitQuery?: (next: AutomationQuery) => void;
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
    query: AutomationQuery;
    commitQuery: (next: AutomationQuery) => void;
  }): FakeAutomationHost {
    return new FakeAutomationHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  scope(): AutomationScope {
    return {
      organizationId: this.organization()?.id ?? null,
      teamId: this.team()?.id ?? null,
      projectId: this.project()?.id ?? null,
    };
  }

  organization(): AutomationOrganization | undefined {
    const configured = this.options.organization;
    if (configured === void 0) return FAKE_ORGANIZATION;
    return configured ?? void 0;
  }

  team(): AutomationTeam | undefined {
    const configured = this.options.team;
    if (configured === void 0) return FAKE_TEAM;
    return configured ?? void 0;
  }

  project(): AutomationProject | undefined {
    const configured = this.options.project;
    if (configured === void 0) return FAKE_PROJECT;
    return configured ?? void 0;
  }

  hasPermission(permission: string): boolean {
    return permissionSatisfiedBy({ granted: this.granted, requested: permission });
  }

  isFeatureEnabled(flag: string): boolean {
    return this.featureFlag(flag) === true;
  }

  featureFlag(flag: string): boolean | undefined {
    const flags = this.options.enabledFlags ?? "all";
    if (flags === "pending") return void 0;
    if (flags === "all") return true;
    return flags.includes(flag);
  }

  appBaseUrl(): string {
    return this.options.appBaseUrl ?? DEFAULT_APP_BASE_URL;
  }

  route(): AutomationRouteReading {
    return this.routeReading;
  }

  setQuery(next: AutomationQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  openDrawer(request: {
    drawer: AutomationDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.recording.drawerOpens.push({
      drawer: request.drawer,
      params: request.params ?? {},
    });
  }

  succeeded(notice: AutomationSuccessNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: AutomationFailureNotice): void {
    this.recording.failures.push(failure);
  }

  /**
   * The one line `apps/ui` would show for this failure.
   *
   * The real host asks the feedback capability, which falls back to the action
   * name plus the generic sentence for a code it cannot name. That fallback is
   * the whole answer here, so a test never depends on copy that lives in a
   * registry this package cannot see.
   */
  describeFailure(failure: AutomationFailureNotice): string {
    return failure.title ?? failure.fallbackTitle;
  }
}

export function fakeAutomationHost(options: FakeAutomationHostOptions = {}): FakeAutomationHost {
  return FakeAutomationHost.create(options);
}

export type RecordingAutomationToaster = AutomationToaster & {
  /** Every toast the code under test raised, in order. */
  readonly toasts: AutomationToast[];
};

export function recordingAutomationToaster(): RecordingAutomationToaster {
  const toasts: AutomationToast[] = [];
  return {
    toasts,
    create: (toast: AutomationToast) => {
      toasts.push(toast);
    },
  };
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key removed —
 * which is the contract the port states and the one every surface that filters,
 * paginates or selects a tab relies on.
 */
function AutomationHostHarness({
  host,
  children,
}: {
  host: FakeAutomationHost;
  children: ReactNode;
}) {
  const [query, setQuery] = useState<AutomationQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return <AutomationHostProvider value={live}>{children}</AutomationHostProvider>;
}

/** Mounts an automations surface the way its frontend feature mounts it. */
export function renderWithAutomationHost(
  element: ReactElement,
  { host }: { host: FakeAutomationHost },
): RenderResult {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AutomationHostHarness host={host}>{element}</AutomationHostHarness>
    </ChakraProvider>,
  );
}
