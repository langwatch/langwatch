// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The application a governance screen is mounted in, faked.
 *
 * Every screen in this package reads the world through `GovernanceHostPort`:
 * who is here, what they may do, which flags are on, what the address says,
 * and where a success or a failure is announced. A test that mounts a screen
 * therefore has to answer that port, and answering it ad hoc per file is how
 * a dozen suites come to disagree about what a delegated viewer is.
 *
 * Two things live here. `fakeGovernanceHost` builds the port from a small
 * configuration and records everything written through it, so an assertion
 * about a navigation or a toast reads off `host.recording` rather than off a
 * spy on a module. `renderWithGovernanceHost` mounts a tree underneath it and
 * owns the one piece of state a static double cannot have: the query string.
 * The inventory's tab strip is controlled by `?tab=`, so a click that writes
 * the address has to come back as a re-render, or the pane never changes and
 * the test proves nothing.
 *
 * Permissions resolve through `permissionSatisfiedBy`, the authz contract's
 * own hierarchy rule (`<resource>:manage` satisfies `<resource>:view` on the
 * same resource), rather than through a set-membership check written here.
 * A test that passes against this double therefore cannot pass by disagreeing
 * with the rule the server applies — the property the platform suites had by
 * importing the real `hasPermissionWithHierarchy`, kept across the move.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { permissionSatisfiedBy } from "@langwatch/authz-contract";
import { render, type RenderResult } from "@testing-library/react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import type { GovernanceToast, GovernanceToaster } from "./behavior/governance-feedback";
import {
  GovernanceHostPort,
  GovernanceHostProvider,
  type GovernanceDeployment,
  type GovernanceFailureNotice,
  type GovernanceOrganization,
  type GovernancePlan,
  type GovernanceRouteReading,
  type GovernanceScope,
  type GovernanceSuccessNotice,
} from "./model/governance-host";

export type GovernanceQuery = Readonly<Record<string, string | undefined>>;

/** Everything a screen wrote through the host, in the order it wrote it. */
export type GovernanceHostRecording = {
  navigations: string[];
  queries: Array<{ next: GovernanceQuery; replace: boolean }>;
  successes: GovernanceSuccessNotice[];
  failures: GovernanceFailureNotice[];
};

/**
 * The organization the governance section is about, unless a test says
 * otherwise. Same row the platform suites handed `useOrganizationTeamProject`.
 */
export const FAKE_ORGANIZATION: GovernanceOrganization = {
  id: "org-1",
  name: "ACME",
  slug: "acme",
  teams: [],
};

export type FakeGovernanceHostOptions = {
  /** The grants the viewer holds, read through the authz hierarchy rule. */
  permissions?: readonly string[];
  /**
   * The frontend flags that are on. `"all"` is the default because the
   * platform suites mocked `useFeatureFlag` to answer yes; name a list when
   * the flag itself is what a test is about.
   */
  enabledFlags?: readonly string[] | "all";
  /** `null` means the scope has not resolved, which several screens gate on. */
  organization?: GovernanceOrganization | null;
  organizations?: readonly GovernanceOrganization[];
  plan?: GovernancePlan;
  deployment?: GovernanceDeployment;
  /** Path parameters the screen was opened with, for example `{ id: "src-1" }`. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the screen opens on. */
  query?: GovernanceQuery;
};

const DEFAULT_PLAN: GovernancePlan = { isEnterprise: true, isLoading: false };
const DEFAULT_DEPLOYMENT: GovernanceDeployment = {
  isSaas: true,
  appBaseUrl: "https://app.langwatch.ai",
};

export class FakeGovernanceHost extends GovernanceHostPort {
  static create(options: FakeGovernanceHostOptions = {}): FakeGovernanceHost {
    return new FakeGovernanceHost({
      options,
      recording: { navigations: [], queries: [], successes: [], failures: [] },
      query: options.query ?? {},
    });
  }

  /** Shared with every host derived from this one, so one read sees them all. */
  readonly recording: GovernanceHostRecording;
  readonly query: GovernanceQuery;

  private readonly options: FakeGovernanceHostOptions;
  private readonly granted: ReadonlySet<string>;
  private readonly commitQuery: ((next: GovernanceQuery) => void) | undefined;
  /**
   * Built once per instance rather than per call. `useGovernanceRouter` and
   * `useGovernanceSearchParams` both memoize on the reading, and a fresh
   * object every render would rebuild the params on every render with it.
   */
  private readonly routeReading: GovernanceRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakeGovernanceHostOptions;
    recording: GovernanceHostRecording;
    query: GovernanceQuery;
    commitQuery?: (next: GovernanceQuery) => void;
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
    query: GovernanceQuery;
    commitQuery: (next: GovernanceQuery) => void;
  }): FakeGovernanceHost {
    return new FakeGovernanceHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  scope(): GovernanceScope {
    return { organizationId: this.organization()?.id ?? null, projectId: null };
  }

  organizations(): readonly GovernanceOrganization[] {
    return this.options.organizations ?? [];
  }

  organization(): GovernanceOrganization | undefined {
    const configured = this.options.organization;
    if (configured === void 0) return FAKE_ORGANIZATION;
    return configured ?? void 0;
  }

  hasPermission(permission: string): boolean {
    return permissionSatisfiedBy({ granted: this.granted, requested: permission });
  }

  isFeatureEnabled(flag: string): boolean {
    const flags = this.options.enabledFlags ?? "all";
    return flags === "all" || flags.includes(flag);
  }

  plan(): GovernancePlan {
    return this.options.plan ?? DEFAULT_PLAN;
  }

  deployment(): GovernanceDeployment {
    return this.options.deployment ?? DEFAULT_DEPLOYMENT;
  }

  route(): GovernanceRouteReading {
    return this.routeReading;
  }

  setQuery(next: GovernanceQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  succeeded(notice: GovernanceSuccessNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: GovernanceFailureNotice): void {
    this.recording.failures.push(failure);
  }
}

export function fakeGovernanceHost(options: FakeGovernanceHostOptions = {}): FakeGovernanceHost {
  return FakeGovernanceHost.create(options);
}

export type RecordingGovernanceToaster = GovernanceToaster & {
  /** Every toast the code under test raised, in order. */
  readonly toasts: GovernanceToast[];
};

/**
 * The toaster the pure builders take as an argument.
 *
 * `buildCreateInput`, `buildEditSubmission` and `buildRulePayload` name the
 * offending field when a payload will not build, and they are handed the
 * toaster rather than reaching for one — which is what lets a test assert on
 * that reporting without rendering anything. It lives beside the host double
 * because it is the same seam: in production the toaster is derived from the
 * host, and a suite that needs one needs the other soon after.
 */
export function recordingGovernanceToaster(): RecordingGovernanceToaster {
  const toasts: GovernanceToast[] = [];
  return {
    toasts,
    create: (toast: GovernanceToast) => {
      toasts.push(toast);
    },
  };
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key
 * removed — which is the contract the port states and the one the tab strip
 * relies on to drop `?tab=` when the default is selected again.
 */
function GovernanceHostHarness({
  host,
  children,
}: {
  host: FakeGovernanceHost;
  children: ReactNode;
}) {
  const [query, setQuery] = useState<GovernanceQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return <GovernanceHostProvider value={live}>{children}</GovernanceHostProvider>;
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

/** Mounts a governance screen the way its frontend feature mounts it. */
export function renderWithGovernanceHost(
  element: ReactElement,
  { host }: { host: FakeGovernanceHost },
): RenderResult {
  installBrowserApisJsdomLacks();
  return render(
    <ChakraProvider value={defaultSystem}>
      <GovernanceHostHarness host={host}>{element}</GovernanceHostHarness>
    </ChakraProvider>,
  );
}
