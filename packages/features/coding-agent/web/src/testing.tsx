/**
 * The surface a coding-agent activity table is mounted in, faked.
 *
 * The tables read the world through `CodingAgentActivityHostPort`: what the
 * reader may do, what the address says, and where a notice goes. A test that
 * mounts one therefore has to answer that port, and answering it ad hoc per
 * file is how three suites come to disagree about what a viewer is.
 *
 * `fakeCodingAgentActivityHost` builds the port from a small configuration and
 * records everything written through it, so an assertion about a navigation or
 * a toast reads off `host.recording` rather than off a spy on a module.
 * `renderWithCodingAgentHost` mounts a tree underneath it and owns the one
 * piece of state a static double cannot have: the query string. The pull
 * request detail drawer opens from `?pullRequest=`, so a click that writes the
 * address has to come back as a re-render, or the drawer never opens and the
 * test proves nothing.
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
  CodingAgentActivityHostPort,
  CodingAgentActivityHostProvider,
  type CodingAgentFailure,
  type CodingAgentNotice,
  type CodingAgentRouteReading,
} from "./coding-agent-activity-host";

export type CodingAgentQuery = Readonly<Record<string, string | undefined>>;

/** Everything a table wrote through the host, in the order it wrote it. */
export type CodingAgentHostRecording = {
  navigations: string[];
  queries: Array<{ next: CodingAgentQuery; replace: boolean }>;
  successes: CodingAgentNotice[];
  failures: CodingAgentFailure[];
};

export type FakeCodingAgentHostOptions = {
  /** The grants the viewer holds, read through the authz hierarchy rule. */
  permissions?: readonly string[];
  /** Path parameters the surface was opened with. */
  params?: Readonly<Record<string, string | undefined>>;
  /** The query string the surface opens on. */
  query?: CodingAgentQuery;
};

export class FakeCodingAgentActivityHost extends CodingAgentActivityHostPort {
  static create(options: FakeCodingAgentHostOptions = {}): FakeCodingAgentActivityHost {
    return new FakeCodingAgentActivityHost({
      options,
      recording: { navigations: [], queries: [], successes: [], failures: [] },
      query: options.query ?? {},
    });
  }

  /** Shared with every host derived from this one, so one read sees them all. */
  readonly recording: CodingAgentHostRecording;
  readonly query: CodingAgentQuery;

  private readonly options: FakeCodingAgentHostOptions;
  private readonly granted: ReadonlySet<string>;
  private readonly commitQuery: ((next: CodingAgentQuery) => void) | undefined;
  /**
   * Built once per instance rather than per call. `useCodingAgentRouter`
   * memoizes on the reading, and a fresh object every render would rebuild the
   * router with it.
   */
  private readonly routeReading: CodingAgentRouteReading;

  private constructor({
    options,
    recording,
    query,
    commitQuery,
  }: {
    options: FakeCodingAgentHostOptions;
    recording: CodingAgentHostRecording;
    query: CodingAgentQuery;
    commitQuery?: (next: CodingAgentQuery) => void;
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
    query: CodingAgentQuery;
    commitQuery: (next: CodingAgentQuery) => void;
  }): FakeCodingAgentActivityHost {
    return new FakeCodingAgentActivityHost({
      options: this.options,
      recording: this.recording,
      query,
      commitQuery,
    });
  }

  hasPermission(permission: string): boolean {
    return permissionSatisfiedBy({ granted: this.granted, requested: permission });
  }

  route(): CodingAgentRouteReading {
    return this.routeReading;
  }

  setQuery(next: CodingAgentQuery, options?: { replace?: boolean }): void {
    this.recording.queries.push({ next, replace: options?.replace ?? false });
    this.commitQuery?.(next);
  }

  navigate(to: string): void {
    this.recording.navigations.push(to);
  }

  succeeded(notice: CodingAgentNotice): void {
    this.recording.successes.push(notice);
  }

  failed(failure: CodingAgentFailure): void {
    this.recording.failures.push(failure);
  }
}

export function fakeCodingAgentActivityHost(
  options: FakeCodingAgentHostOptions = {},
): FakeCodingAgentActivityHost {
  return FakeCodingAgentActivityHost.create(options);
}

/**
 * The address, held where React can see it change.
 *
 * `setQuery` replaces the whole query string — a key left out is a key removed —
 * which is the contract the port states and the one the tables rely on to drop
 * `?pullRequest=` when the drawer closes.
 */
function CodingAgentHostHarness({
  host,
  children,
}: {
  host: FakeCodingAgentActivityHost;
  children: ReactNode;
}) {
  const [query, setQuery] = useState<CodingAgentQuery>(host.query);
  const live = useMemo(
    () => host.withQuery({ query, commitQuery: (next) => setQuery(next) }),
    [host, query],
  );
  return <CodingAgentActivityHostProvider value={live}>{children}</CodingAgentActivityHostProvider>;
}

/**
 * The tree an activity table is mounted inside, as a Testing Library wrapper.
 *
 * A wrapper rather than a wrapped element, so `rerender` keeps the host and the
 * query state: Testing Library re-applies the wrapper on every re-render, and a
 * test that re-renders to prove a shrinking list is doing exactly that.
 */
export function codingAgentHostWrapper(host: FakeCodingAgentActivityHost) {
  return ({ children }: { children: ReactNode }) => (
    <ChakraProvider value={defaultSystem}>
      <CodingAgentHostHarness host={host}>{children}</CodingAgentHostHarness>
    </ChakraProvider>
  );
}

/** Mounts an activity table the way a screen mounts it. */
export function renderWithCodingAgentHost(
  element: ReactElement,
  { host }: { host: FakeCodingAgentActivityHost },
): RenderResult {
  return render(element, { wrapper: codingAgentHostWrapper(host) });
}
