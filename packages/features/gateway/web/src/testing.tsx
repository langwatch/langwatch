/**
 * The application an AI Gateway screen is mounted in, faked.
 *
 * Every screen in this package reads the world through `GatewayHostPort`: who
 * is here, what they may do, which flags are on, which plan the organization is
 * on, what the address says, and where a success or a failure is announced. A
 * test that mounts a screen therefore has to answer that port, and answering it
 * ad hoc per file is how a dozen suites come to disagree about what a viewer is.
 *
 * Two things live here. `fakeGatewayHost` builds the port from a small
 * configuration and records everything written through it, so an assertion
 * about a navigation or a toast reads off `host.recording` rather than off a spy
 * on a module. `renderWithGatewayHost` mounts a tree underneath it and owns the
 * one piece of state a static double cannot have: the query string. A screen
 * reads its own address back — a filter, a page, a selected tab — so a write has
 * to come back as a re-render or the test proves nothing.
 *
 * The routing policy editor is not one of them any more. It opens through the
 * drawer registry, which the composing application mounts above every page, so
 * what this double answers for it is `openDrawer`: it records which overlay was
 * asked for, and the address that carries the request is the application's to
 * spell.
 *
 * Permissions resolve through `permissionSatisfiedBy`, the authz contract's own
 * hierarchy rule (`<resource>:manage` satisfies `<resource>:view` on the same
 * resource), rather than through a set-membership check written here. A test
 * that passes against this double therefore cannot pass by disagreeing with the
 * rule the server applies — the property the platform suites had by importing
 * the real `hasPermissionWithHierarchy`, kept across the move.
 *
 * The same shape as `@langwatch/enterprise-governance-web`'s harness, because
 * the two host ports are the same shape. They converge if a third family
 * repeats them.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { GatewayToast, GatewayToaster } from "./behavior/gateway-feedback";
import {
  GatewayHostPort,
  GatewayHostProvider,
  type GatewayActor,
  type GatewayDeployment,
  type GatewayDrawer,
  type GatewayFailureNotice,
  type GatewayOrganization,
  type GatewayPlan,
  type GatewayProject,
  type GatewayRouteReading,
  type GatewayScope,
  type GatewaySuccessNotice,
  type GatewayTeam,
} from "./model/gateway-host";

export type GatewayQuery = Readonly<Record<string, string | undefined>>;

/** One overlay a screen asked the application to open. */
export type RecordedGatewayDrawerOpen = {
  drawer: GatewayDrawer;
  params: Readonly<Record<string, string | undefined>>;
};

/** Everything a screen wrote through the host, in the order it wrote it. */
export type GatewayHostRecording = {
  navigations: string[];
  queries: Array<{ next: GatewayQuery; replace: boolean }>;
  /**
   * RECORDED RATHER THAN SPELLED. The `drawer.` vocabulary is the composing
   * application's — its adapter writes `?drawer.open=<name>` plus one
   * `drawer.<key>` per parameter, and its own suite pins that. What this
   * package can state is WHICH overlay a click asked for, and with what.
   */
  drawerOpens: RecordedGatewayDrawerOpen[];
  successes: GatewaySuccessNotice[];
  failures: GatewayFailureNotice[];
};

/**
 * The organization the gateway section is about, unless a test says otherwise.
 * The same row the platform suites handed `useOrganizationTeamProject`.
 */
export const FAKE_ORGANIZATION: GatewayOrganization = {
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

export const FAKE_ACTOR: GatewayActor = {
  id: "user-1",
  name: "Carol",
  email: "carol@acme.example",
};

export type FakeGatewayHostOptions = {
  /** The grants the viewer holds, read through the authz hierarchy rule. */
  permissions?: readonly string[];
  /**
   * The frontend flags that are on. `"all"` is the default because the platform
   * suites mocked `useFeatureFlag` to answer yes; name a list when the flag
   * itself is what a test is about.
   */
  enabledFlags?: readonly string[] | "all";
  /** `null` means the scope has not resolved, which several screens gate on. */
  organization?: GatewayOrganization | null;
  organizations?: readonly GatewayOrganization[];
  /** `null` means no project is in scope, which the project-keyed pages gate on. */
  project?: GatewayProject | null;
  currentUser?: GatewayActor | null;
  plan?: GatewayPlan;
  deployment?: GatewayDeployment;
  /** Path parameters the screen was opened with, for example `{ id: "vk_1" }`. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the screen opens on. */
  query?: GatewayQuery;
};

const DEFAULT_PLAN: GatewayPlan = {
  isEnterprise: true,
  webhookEndpointsEnabled: true,
  isLoading: false,
};
const DEFAULT_DEPLOYMENT: GatewayDeployment = {
  isSaas: true,
  appBaseUrl: "https://app.langwatch.ai",
  gatewayBaseUrl: "https://gateway.langwatch.ai/v1",
};

export class FakeGatewayHost extends GatewayHostPort {
  static create(options: FakeGatewayHostOptions = {}): FakeGatewayHost {
    return new FakeGatewayHost({
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
  readonly recording: GatewayHostRecording;
  readonly query: GatewayQuery;

  private readonly options: FakeGatewayHostOptions;
  private readonly granted: ReadonlySet<string>;
  private readonly commitQuery: ((next: GatewayQuery) => void) | undefined;
  /**
   * Built once per instance rather than per call: the screens memoize on the
   * reading, and a fresh object every render would rebuild the router with it.
   */
  private readonly routeReading: GatewayRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakeGatewayHostOptions;
    recording: GatewayHostRecording;
    query: GatewayQuery;
    commitQuery?: (next: GatewayQuery) => void;
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
    query: GatewayQuery;
    commitQuery: (next: GatewayQuery) => void;
  }): FakeGatewayHost {
    return new FakeGatewayHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  scope(): GatewayScope {
    return {
      organizationId: this.organization()?.id ?? null,
      projectId: this.project()?.id ?? null,
    };
  }

  organizations(): readonly GatewayOrganization[] {
    return this.options.organizations ?? [];
  }

  organization(): GatewayOrganization | undefined {
    const configured = this.options.organization;
    if (configured === void 0) return FAKE_ORGANIZATION;
    return configured ?? void 0;
  }

  project(): GatewayProject | undefined {
    const configured = this.options.project;
    if (configured === void 0) return this.organization()?.teams[0]?.projects[0];
    return configured ?? void 0;
  }

  team(): GatewayTeam | undefined {
    const project = this.project();
    if (!project) return void 0;
    return this.organization()?.teams.find((team) => team.id === project.teamId);
  }

  currentUser(): GatewayActor | null {
    const configured = this.options.currentUser;
    return configured === void 0 ? FAKE_ACTOR : configured;
  }

  hasPermission(permission: string): boolean {
    return permissionSatisfiedBy({ granted: this.granted, requested: permission });
  }

  isFeatureEnabled(flag: string): boolean {
    const flags = this.options.enabledFlags ?? "all";
    return flags === "all" || flags.includes(flag);
  }

  plan(): GatewayPlan {
    return this.options.plan ?? DEFAULT_PLAN;
  }

  deployment(): GatewayDeployment {
    return this.options.deployment ?? DEFAULT_DEPLOYMENT;
  }

  route(): GatewayRouteReading {
    return this.routeReading;
  }

  setQuery(next: GatewayQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  openDrawer(request: {
    drawer: GatewayDrawer;
    params?: Readonly<Record<string, string | undefined>>;
  }): void {
    this.recording.drawerOpens.push({
      drawer: request.drawer,
      params: request.params ?? {},
    });
  }

  succeeded(notice: GatewaySuccessNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: GatewayFailureNotice): void {
    this.recording.failures.push(failure);
  }
}

export function fakeGatewayHost(options: FakeGatewayHostOptions = {}): FakeGatewayHost {
  return FakeGatewayHost.create(options);
}

export type RecordingGatewayToaster = GatewayToaster & {
  /** Every toast the code under test raised, in order. */
  readonly toasts: GatewayToast[];
};

export function recordingGatewayToaster(): RecordingGatewayToaster {
  const toasts: GatewayToast[] = [];
  return {
    toasts,
    create: (toast: GatewayToast) => {
      toasts.push(toast);
    },
  };
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key removed —
 * which is the contract the port states and the one every screen that filters,
 * paginates or selects a tab relies on. The routing policy editor is no longer
 * among them: it opens through the drawer registry, so what the double answers
 * for it is `openDrawer`.
 */
function GatewayHostHarness({ host, children }: { host: FakeGatewayHost; children: ReactNode }) {
  const [query, setQuery] = useState<GatewayQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return <GatewayHostProvider value={live}>{children}</GatewayHostProvider>;
}

/**
 * jsdom ships neither of these, and both are reached by Chakra's overlays on
 * the way to positioning themselves. A missing `ResizeObserver` surfaces as an
 * unhandled rejection out of an animation frame rather than as a failure, so
 * the shard fails with its own summary all green.
 */
function installBrowserApisJsdomLacks(): void {
  if (typeof window === "undefined") return;
  if (!window.matchMedia) {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  if (!window.ResizeObserver) {
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }
}

/** Mounts a gateway screen the way its frontend feature mounts it. */
export function renderWithGatewayHost(
  element: ReactElement,
  { host }: { host: FakeGatewayHost },
): RenderResult {
  installBrowserApisJsdomLacks();
  return render(
    <ChakraProvider value={defaultSystem}>
      <GatewayHostHarness host={host}>{element}</GatewayHostHarness>
    </ChakraProvider>,
  );
}
